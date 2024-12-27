# Twilio Media Stream Server va OpenAI Integratsiyasi O'zbek tilida

## Umumiy Ma'lumot

Ushbu loyiha, real vaqtli audio ma'lumotlarni boshqarish, OpenAI GPT-3.5/4 modellari yordamida ularni qayta ishlash va foydalanuvchilar bilan ovozli va matnli aloqani amalga oshirish uchun Twilio, OpenAI va boshqa xizmatlar bilan integratsiya qilingan media stream serverini o'rnatadi. Server telefon orqali qo'ng'iroqlarni amalga oshirish, qabul qilish, audio yozuvlarini saqlash, nutqni matnga aylantirish va foydalanuvchi so'rovlariga asoslangan aqlli javoblarni yaratish imkonini beradi.

## Xususiyatlar

- **Twilio Integratsiyasi**: Twilio yordamida qo'ng'iroqlarni amalga oshirish va qabul qilish, real vaqtli media stream qo'llab-quvvatlanadi.
- **OpenAI Integratsiyasi**: OpenAI real-time API yordamida foydalanuvchi nutqini tahlil qilish va ularga real vaqt rejimida javob berish.
- **Nutqdan Matnga Aylantirish (STT)**: Audio yozuvlarini nutqqa aylantirish uchun uchinchi tomon STT xizmati (`mohir.uzbekvoice.ai`) ishlatiladi.
- **Real-Time Media Streaming**: Server va OpenAI o'rtasida audio ma'lumotlar WebSocket formatida real vaqt rejimida uzatiladi.
- **Audio Yozuvlari**: Qo'ng'iroqlarni lokal serverga audio yozuvlarini saqlash.

## O'rnatish

### Talablar

- Node.js (>= v16.x)
- Twilio akkaunti va ma'lumotlari (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`)
- OpenAI API kaliti (`OPENAI_API_KEY`)
- Nutqdan matnga aylantirish API kaliti (`MOHIR_DEV_API`)
- Status callbacklar uchun server URL (`SERVER_HOST`)

### O'rnatish

1. Repository-ni klonlash:

   ```bash
   git clone https://github.com/your-username/twilio-media-stream-server.git
   cd twilio-media-stream-server
