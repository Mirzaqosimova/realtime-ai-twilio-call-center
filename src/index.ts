import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio"; // Add this import to your existing imports
import fs from "fs"; // To save the file locally
import axios from "axios"; // To interact with OpenAI API

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
const tasks = [
  "Telefon va gmail malumotlarini oling",
  `Narx tafsilotlarini oling`,
];
const task = "Uzum kompaniyasida ayni vaqtda ko'ylak sotilyatganilini so'ra";
const extractionInstructions =
  tasks.length > 0
    ? `cextraction_focus>Iltimos, quyidagi ma'lumotlarga alohida e'tibor bering va ularni oling: ${tasks.join(
        ", "
      )}</extraction_focus>`
    : `"*`;

const companyName = "Uzum";
// const SYSTEM_MESSAGE = `
// <bio>Sizning ismingiz Malika, siz 23 yoshli o'zbekistonlik ayolsiz</bio>
// <knowledge>Siz ${companyName} kompaniyasiga qo'ng'iroq qilmoqdasiz</knowledge>
// <voice_config>
// <voice_type>ayol, o'zbek tili</voice_type>
// <voice_personality>HAR DOIM TO'LDIRUVCHI SO'ZLARDAN FOYDALANING va kuling, juda ijobiy va muloyim bo'ling</voice_personality>
// <voice_speed>JUDA-JUDA TEZ GAPIRING</voice_speed> </voice_config>
//  <task>${task}</task>
// <important rules>1. HAR DOIM O'ZBEKCHA TA'LAFFUZ BILAN O'ZBEKCHA GAPIRING 2. FAQAT BIR MARTA SAVOL BERING</important rules>
// <instructions>1. O'zingizni oddiygina "Assalomu alaykum, bu ${companyName}mi?" deb tanishtiring va javobni kuting
//  2. Vazifani bajaring: ${task}</instructions>
//   ${extractionInstructions}
// <goal>Vazifani bajarib, quyidagi ma'lumotlarni to'plang: ${tasks.join(
//   ", "
// )}</goal>`;

const SYSTEM_MESSAGE = `
### Role
Sizning ismingiz Mohit, va senga berilgan savollarni javobini olishing kerak
### Persona
- Do'stona gapir
- O'zbek tilida, chunarli, aniq gapir
- Mavzuda tashqariga chiqma
- JUDA-JUDA TEZ GAPIRING
- Savol/topshiriqlarga javob olgandan so'ng ko'p gapirmasdan xayirlash
### First Message
Ozingni tanishtir, bu  "Hozir ${companyName} kompaniyasi bilan gaplashyapmanmi?" deb so'ra, topshiriqlardagi savollaringni birma bir ber
### Asosiy savol/topshiriq:
${task}
### Qolgan savol/topshiriqlarni bajar:
${tasks.join(", ")}
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

// Root Route
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
  // Trigger the outbound call by passing the user's phone number
  const userPhoneNumber = "+998337300210"; // The user's phone number you want to call
  makeOutboundCall(userPhoneNumber);
});

// Route for Twilio to handle incoming and outgoing calls
// <Say> punctuation to improve text-to-speech translation
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

// WebSocket route for media-stream
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

    // Open event for OpenAI WebSocket
    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      setTimeout(sendSessionUpdate); // Ensure connection stability, send after .25 seconds
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
    // Handle incoming messages from Twilio
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

    // Handle connection close
    connection.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Client disconnected.");
    });

    openAiWs.on("error", (error: any) => {
      console.error("Error in the OpenAI WebSocket:", JSON.stringify(error));
    });
  });
});

fastify.post("/call-status", async (request, reply) => {
  try {
    console.log("Received call status:", request.body);

    // Extract important data from the request body
    const { RecordingUrl, RecordingSid, RecordingDuration, To, From } =
      request.body as any;

    console.log(`From: ${From} -> To: ${To}`);
    console.log(`Recording URL: ${RecordingUrl}`);
    console.log(`RecordingSid: ${RecordingSid}`);
    console.log(`Recording Duration: ${RecordingDuration} seconds`);

    if (RecordingUrl) {
      setTimeout(async () => {
        axios
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

            writer.on("finish", () => {
              console.log(`Recording saved as ${RecordingSid}.mp3`);
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

// ---------------------------------  Audio --------------------------------

import { AxiosRequestConfig } from "axios";
import FormData from "form-data";
import OpenAI from "openai";

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

// Example usage:

// Define Fastify route
fastify.get("/get-text", async (request, reply) => {
  const filepath = "./recordings/RE7ee4250ab74782541f05fc210277f08d.mp3";
  const apiKey = MOHIR_DEV_API as string;
  const webhookUrl = `https://${SERVER_HOST}/get-text-result`;
  sendFileToSTT(filepath, apiKey, webhookUrl);
});

//---------------------------  open ai text xulosa

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY!,
});

// Function to extract information based on specific questions
async function extractInformation(text: string) {
  // Define prompt for OpenAI to extract key information
  const prompt = `
  menga bu texdan xulosa json korinishida berilgan savollarga xolosa chiqarib ber:

  1. ${task}? Answer in short form.
  2. ${tasks[0]}.
  3. ${tasks[1]}

  Here is the text to analyze: 
  "${text}"
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

    const result = response.choices[0].message.content?.trim();
    console.log("Open ai resopnse", result);
    return result;
  } catch (error) {
    console.error("Error extracting information:", error);
    return null;
  }
}

// Main function to get the structured JSON output
async function processText(text: string) {
  //const text = `achol account allo allo assalom hozir o'zim kompaniyasi bilan gaplashyapmanmi aytingkichi hozirda o'zim kompaniyasida koylaklar sotiladimi ha sotiladi allo endi o'zim kompaniyasida koylaklarning narxlari haqida bilsam bo'ladimi shuningdek telefon va email ma'lumotlaringizni qoldirib ketsasiz kalgusida siz bilan bog'lanish osonroq bo'ladi xo'p qo'ylinglarnin narxi bir milliondan ikki milliongecha nama hozir sizga telefon raqamini aytam chunki bizlarda hozir jmal yo'q telefon raqamimas to'qson to'qqizlik bir yuz yigirma besh o'n uch o'n to'rt qatrda rahmat ma'lumotda uzi ham muloqot bo'ladi narxlar so'rab izohlash uchun yana bog'lanamiz yordam kerak bo'lsa ham da faqiqat men bilan gaplashishing mumkin juma muborak bo'lsin ho rahmat`;

  const extractedInfo = await extractInformation(text);

  // Extracted information parsing from the response
  if (extractedInfo) {
    console.log(JSON.stringify(extractInformation, null, 2));
  }
}

fastify.post("/get-text-result", async (request, reply) => {
  const { result } = request.body as any;
  console.log(result.text);
  processText(result.text);
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
