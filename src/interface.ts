export const ExtraTasks = [
  {
    id: 1,
    name: "Uchrashuv vaqti",
    description: "Bo'sh ish kunlari xaqida malumotlar",
  },
  {
    id: 2,
    name: "Mavjudlik",
    description: "Xizmat mavjudligi haqida ma'lumot ol",
  },
  {
    id: 3,
    name: "Maxsus talablar",
    description: "Har qanday maxsus talab yoki shartlar haqida malumot",
  },
  {
    id: 4,
    name: "Narx haqida malumot",
    description: "Narx tafsilotlari haqida malumot",
  },
  {
    id: 5,
    name: "Kontact malumotlari",
    description: "Kontakt malumotlari haqida malumot",
  },
];
export enum MethodType {
  CREATE = "create",
  MP3_ADD = "mp3_add",
  XULOSA = "xulosa",
  TEXT = "text",
}
export interface DataStore {
  company_name?: string;
  company_phone?: string;
  task?: string;
  extra_tasks?: string[];
  mp3_path?: string;
  text?: string;
  asosiy_xulosa?: string;
  qoshimcha_xulosalar?: string;
  created_at?: string;
}
