import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio"; // Add this import to your existing imports
import fs from "fs"; // To save the file locally
import axios from "axios"; // To interact with OpenAI API
import { AxiosRequestConfig } from "axios";
import FormData from "form-data";
import OpenAI from "openai";
import { DataStore, ExtraTasks, MethodType } from "./interface";

dotenv.config();

const {
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  SERVER_HOST,
  MOHIR_DEV_API,
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
let TASKS = [""];
let TASK =
  "'Cat house' kompaniyasida ayni vaqtda mushuklar bor yoqligi haqida malumot sora";

let COMPANY_NAME = "'Cat house'";
let COMPANY_PHONE = "";
let SYSTEM_MESSAGE = `
### Role
Sizning ismingiz Mohir, va senga berilgan savollarni javobini olishing kerak
### Persona
- O'zbek tilida, chunarli, aniq gapir.
- Mavzuda tashqariga chiqma
- JUDA-JUDA TEZ GAPIRING
- Savol/topshiriqlarga javob olgandan so'ng ko'p gapirmasdan xayirlash
### First Message
O'zingni tanishtir,   "Hozir ${COMPANY_NAME} bilan gaplashyapmanmi?" deb so'ra va topshiriqlardagi savollaringni birma bir ber
### Asosiy savol/topshiriqni birinchi so'ra
${TASK}
### Qolgan savol/topshiriqlarni bajar:
${TASKS.join(", ")}
`;

const VOICE = "alloy";
const PORT = 5000;
const LOG_EVENT_TYPES = [
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];

const twilioClient = Twilio(
  TWILIO_ACCOUNT_SID as string,
  TWILIO_AUTH_TOKEN as string
);

const makeOutboundCall = async (toPhoneNumber: string) => {
  try {
    const call = await twilioClient.calls.create({
      to: toPhoneNumber,
      from: TWILIO_PHONE_NUMBER as string, // Your Twilio phone number
      url: `https://${SERVER_HOST}/outgoing-call`, // Your server's URL for the call webhook
      record: true, // Enable call recording
      statusCallback: `https://${SERVER_HOST}/call-status`, // Callback URL for status updates
      statusCallbackEvent: ["completed"], // Trigger callback when the call is completed
    });
    console.log("Outbound call initiated", call.sid);
  } catch (error) {
    console.error("Error making outbound call:", error);
  }
};

fastify.post("/create", async (request, reply) => {
  const { company_name, company_phone, task, extra_tasks } =
    request.body as any;
  TASK = task;
  COMPANY_NAME = company_name;
  TASKS = extra_tasks;
  COMPANY_PHONE = company_phone;

  SYSTEM_MESSAGE = `
### Role
Sizning ismingiz Mohir, va senga berilgan savollarni javobini olishing kerak
### Persona
- Do'stona gapir
- FAQAT SAVOL BER! va javobini kut
- Yordam berma
- O'zbek tilida, chunarli, aniq gapir
- Mavzuda tashqariga chiqma
- JUDA-JUDA TEZ GAPIRING
- Savol/topshiriqlarga aniq javob olgandan so'ng ko'p gapirmasdan xayirlash
### First Message
Ozingni tanishtir, bu  "Hozir ${COMPANY_NAME} kompaniyasi bilan gaplashyapmanmi?" deb so'ra, topshiriqlardagi savollaringni birma bir barchasini ber
### Asosiy savol/topshiriq:
${TASK}
### Qolgan savol/topshiriqlarni bajar:
${TASKS.join(", ")}
`;
  await updateFileData(
    { company_name, company_phone, task, extra_tasks },
    MethodType.CREATE
  );
  // const userPhoneNumber = "+998337300210";
  makeOutboundCall(company_phone);
});

fastify.all("/outgoing-call", async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/media-stream" />
        </Connect>
      </Response>`;
  reply.type("text/xml").send(twimlResponse);
});

fastify.all("/incoming-call", async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;
  reply.type("text/xml").send(twimlResponse);
});

fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected");
    const openAiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    let streamSid: string | null = null;
    const sendSessionUpdate = () => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 1.1,
        },
      };
      console.log("Sending session update:", JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      setTimeout(sendSessionUpdate);
    });

    openAiWs.on("message", (data: any) => {
      try {
        const response = JSON.parse(data);
        console.log(`Received event: ${response.type}`, response);

        if (response?.response?.status === "failed") {
          console.error(
            "OpenAI response failed:",
            response.response.status_details.error
          );
        }

        if (response.type === "session.updated") {
          console.log("Session updated successfully:", response);
        }
        if (response.type === "response.audio.delta" && response.delta) {
          const audioDelta = {
            event: "media",
            streamSid: streamSid,
            media: {
              payload: Buffer.from(response.delta, "base64").toString("base64"),
            },
          };
          connection.send(JSON.stringify(audioDelta));
        }
      } catch (error) {
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data
        );
      }
    });

    connection.on("message", (message: any) => {
      try {
        const data = JSON.parse(message);
        switch (data.event) {
          case "media":
            if (openAiWs.readyState === WebSocket.OPEN) {
              console.log("Sending to open api");
              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case "start":
            streamSid = data.start.streamSid;
            console.log("Incoming stream has started", streamSid);
            break;

          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
      }
    });

    connection.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Client disconnected.");
    });

    openAiWs.on("error", (error: any) => {
      console.error("Error in the OpenAI WebSocket:", JSON.stringify(error));
    });
  });
});

// <-------------------------------------------   Twilio Audio yuklab olish   ------------------------------------------->

fastify.post("/call-status", async (request, reply) => {
  try {
    console.log("Received call status:", request.body);

    const { RecordingUrl, RecordingSid, RecordingDuration, To, From } =
      request.body as any;

    console.log(`From: ${From} -> To: ${To}`);
    console.log(`Recording URL: ${RecordingUrl}`);
    console.log(`RecordingSid: ${RecordingSid}`);
    console.log(`Recording Duration: ${RecordingDuration} seconds`);
    if (RecordingUrl) {
      setTimeout(async () => {
        await axios
          .get(RecordingUrl, {
            responseType: "stream",
            auth: {
              username: TWILIO_ACCOUNT_SID as string,
              password: TWILIO_AUTH_TOKEN as string,
            },
          })
          .then(async (response) => {
            const writer = await fs.createWriteStream(
              `./recordings/${RecordingSid}.mp3`
            );
            response.data.pipe(writer);

            writer.on("finish", async () => {
              await updateFileData(
                {
                  mp3_path: `/recordings/${RecordingSid}.mp3`,
                  company_phone: COMPANY_PHONE,
                },
                MethodType.MP3_ADD
              );
              console.log(`Recording saved as ${RecordingSid}.mp3`);
              const filepath = `./recordings/${RecordingSid}.mp3`;
              const apiKey = MOHIR_DEV_API as string;
              const webhookUrl = `https://${SERVER_HOST}/get-text-result`;
              sendFileToSTT(filepath, apiKey, webhookUrl);
            });
          })
          .catch((error) => {
            console.error("Error downloading recording:", error);
          });
      }, 10000);
    }
  } catch (error) {
    console.error("Error handling call status:", error);
    reply.status(500).send({ error: "Internal server error" });
  }
});

// <-------------------------------------------   Audiodan text ajratish   ------------------------------------------->

async function sendFileToSTT(
  filePath: string,
  apiKey: string,
  webhookUrl: string
) {
  const data = new FormData();
  data.append("file", fs.createReadStream(filePath));
  data.append("return_offsets", "false");
  data.append("run_diarization", "false");
  data.append("language", "uz");
  data.append("blocking", "false");
  data.append("webhook_notification_url", webhookUrl);

  const config: AxiosRequestConfig = {
    method: "post",
    url: "https://mohir.uzbekvoice.ai/api/v1/stt",
    headers: {
      Authorization: apiKey,
      ...data.getHeaders(),
    },
    data,
  };

  try {
    const res = await axios(config);
    console.log(res.data);
  } catch (error) {
    console.error("Error occurred:", error);
  }
}

fastify.get("/get-text", async (request, reply) => {
  const filepath = "./recordings/RE60d7d897436909096da080a6c73c4b1b.mp3";
  const apiKey = MOHIR_DEV_API as string;
  const webhookUrl = `https://${SERVER_HOST}/get-text-result`;
  sendFileToSTT(filepath, apiKey, webhookUrl);
});

// <-------------------------------------------   Xulosa olish   ------------------------------------------->

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY!,
});

async function extractInformation(text: string) {
  const prompt = `
  menga bu texdan xulosa json korinishida berilgan savollarga xolosa chiqarib ber:

  asosiy_xulosa:
  - ${TASK}? Answer in short form.

  qoshimcha_xulosalar:
  ${TASKS.join("\n- ")}

  Here is the text to analyze: 
  "${text}"

  The output should be in the following JSON format:

  {
    "asosiy_xulosa": "your answer here",
    "qoshimcha_xulosalar":"your answer here"
  }
  `;

  try {
    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts key details from text in Uzbek language.",
        },
        { role: "user", content: prompt },
      ],
      model: "gpt-3.5-turbo",
    });

    const result: any = response.choices[0].message.content?.trim();
    return JSON.parse(result);
  } catch (error) {
    console.error("Error extracting information:", error);
    return null;
  }
}

async function processText(text: string) {
  const extractedData = await extractInformation(text);
  await updateFileData(
    { ...extractedData, company_phone: COMPANY_PHONE },
    MethodType.XULOSA
  );
}

async function updateFileData(data: DataStore, type: MethodType) {
  const filePath = "./files/data.json";
  let existingData = await fs.readFileSync(filePath, "utf-8");
  const parse: DataStore[] = JSON.parse(existingData);
  const hasDataIndex = parse.findIndex(
    (i) => i.company_phone === data.company_phone
  );
  switch (type) {
    case MethodType.CREATE: {
      parse.push(data);
      break;
    }
    case MethodType.MP3_ADD: {
      parse[hasDataIndex].mp3_path = data.mp3_path;
      break;
    }
    case MethodType.TEXT: {
      parse[hasDataIndex].text = data.text;
      break;
    }
    case MethodType.XULOSA: {
      parse[hasDataIndex].asosiy_xulosa = data.asosiy_xulosa;
      parse[hasDataIndex].qoshimcha_xulosalar = data.qoshimcha_xulosalar;
      console.log("Xulosa qoshildi");
      break;
    }
  }

  // Write the updated data back to the file
  await fs.writeFileSync(filePath, JSON.stringify(parse, null, 2), "utf-8");
}

fastify.post("/get-text-result", async (request, reply) => {
  const { result } = request.body as any;
  console.log("response", result.text);
  // const text = `response hava chil akant yokenemuzesnasaja allo allo assalomu alaykum siz bilan kathaus kompaniyasimi ha endi sizga pervoz savollar bor edi aytingchi hozirda sizlarda mushuklar bormi bor buroshga ruxsat so'rang mushuklar boruyanasi bo'lsalarni ma'lumotiga qo'shimcha ravishda ta'minlangan uchrashuv vaqti yoki jadvallari haqida ma'lumot bera olasizmi xizmatlaringizda katsizlar qanday tartibga amalga oshiriladi ha uni o'zingiz kelasiz biz bilan keyin savdolash satolasizha shularni istalgan payt kelsangiz bo'ladi xizmatlarimiz bo'yicha vaqt va jadval haqida kelganda sizga kirdilarmi shunga boz takil bo'laman mostajda marsus talablar yoki shartlar bormi shu bilan birga narx haqida ham ma'lumot biz kerakmiz shularga kelgan javob bera olasizmi maxsus talablar bu anovi shularga mehribon bo'lishingiz kerak narxlari shularni izani besh milliondan o'n milliongacha ma maxsu talablarga ko'ra mushuklngizni olib kelsangiz bemalol o'n besh million gram maznda bo'lishi kerak ekan va narxlari mushuk larasidan kelib xudo dhaliqdaylik hayiqdiylik mushuklaringiz qo'shilmasangiz olib kelsangiz besh millionga o'n milliongacha narxlar bor agar boshqa savollaringiz bo'lsa yordam beraman yo'q ha`;
  await updateFileData(
    { text: result.text, company_phone: COMPANY_PHONE },
    MethodType.TEXT
  );
  processText(result.text);
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
