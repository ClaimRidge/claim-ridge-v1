export interface Payer {
  code: string;
  name: string;
  nameAr?: string;
}

export const PAYERS: Payer[] = [
  {
    code: "GIG_JORDAN",
    name: "Gulf Insurance Group - Jordan",
    nameAr: "مجموعة الخليج للتأمين - الأردن",
  },
  {
    code: "ARAB_ORIENT",
    name: "Arab Orient Insurance (GIG)",
    nameAr: "المجموعة العربية الأردنية للتأمين",
  },
  {
    code: "ALAI",
    name: "Arab Life & Accident Insurance",
    nameAr: "شركة التأمين العربية الحياة والحوادث",
  },
  {
    code: "AL_NISR",
    name: "Al-Nisr Al-Arabi Insurance",
    nameAr: "النسر العربي للتأمين",
  },
  {
    code: "ARAB_ASSURERS",
    name: "Arab Assurers Insurance",
    nameAr: "الضامنون العرب للتأمين",
  },
  {
    code: "JORDAN_INSURANCE",
    name: "Jordan Insurance Company",
    nameAr: "شركة التأمين الأردنية",
  },
  {
    code: "MIDDLE_EAST_INS",
    name: "Middle East Insurance",
    nameAr: "الشرق الأوسط للتأمين",
  },
  {
    code: "ISLAMIC_INSURANCE",
    name: "Islamic Insurance Company",
    nameAr: "الشركة الإسلامية الأردنية للتأمين",
  },
  {
    code: "MEDNET",
    name: "MedNet Jordan (TPA)",
    nameAr: "مدنيت الأردن",
  },
  {
    code: "NEXTCARE",
    name: "NEXtCare (TPA)",
    nameAr: "نكست كير",
  },
];
