// Farmer-view strings. Hindi and Kannada need native-speaker review before real use.
export type Lang = "en" | "hi" | "kn";

export const LANGS: { id: Lang; label: string; speech: string; locale: string }[] = [
  { id: "en", label: "English", speech: "en-IN", locale: "en-IN" },
  { id: "hi", label: "हिंदी", speech: "hi-IN", locale: "hi-IN" },
  { id: "kn", label: "ಕನ್ನಡ", speech: "kn-IN", locale: "kn-IN" },
];

const S = {
  title: { en: "My village weather", hi: "मेरे गाँव का मौसम", kn: "ನನ್ನ ಊರಿನ ಹವಾಮಾನ" },
  choose: { en: "Choose your panchayat", hi: "अपनी पंचायत चुनें", kn: "ನಿಮ್ಮ ಪಂಚಾಯತ್ ಆಯ್ಕೆಮಾಡಿ" },
  search: { en: "Search panchayat name", hi: "पंचायत का नाम खोजें", kn: "ಪಂಚಾಯತ್ ಹೆಸರು ಹುಡುಕಿ" },
  useLocation: { en: "Use my location", hi: "मेरी लोकेशन इस्तेमाल करें", kn: "ನನ್ನ ಸ್ಥಳ ಬಳಸಿ" },
  locating: { en: "Finding you…", hi: "आपकी लोकेशन खोज रहे हैं…", kn: "ನಿಮ್ಮ ಸ್ಥಳ ಹುಡುಕಲಾಗುತ್ತಿದೆ…" },
  locationFailed: {
    en: "Could not get your location. Please search instead.",
    hi: "लोकेशन नहीं मिली। कृपया नाम से खोजें।",
    kn: "ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಹೆಸರಿನಿಂದ ಹುಡುಕಿ.",
  },
  change: { en: "Change", hi: "बदलें", kn: "ಬದಲಿಸಿ" },
  forecast: { en: "Forecast", hi: "पूर्वानुमान", kn: "ಮುನ್ಸೂಚನೆ" },
  whatToDo: { en: "What to do", hi: "क्या करें", kn: "ಏನು ಮಾಡಬೇಕು" },
  nextDays: { en: "Next days", hi: "आने वाले दिन", kn: "ಮುಂದಿನ ದಿನಗಳು" },
  listen: { en: "Listen", hi: "सुनें", kn: "ಕೇಳಿ" },
  stop: { en: "Stop", hi: "रोकें", kn: "ನಿಲ್ಲಿಸಿ" },
  rain: { en: "Rain", hi: "बारिश", kn: "ಮಳೆ" },
  max: { en: "Max", hi: "अधिकतम", kn: "ಗರಿಷ್ಠ" },
  min: { en: "Min", hi: "न्यूनतम", kn: "ಕನಿಷ್ಠ" },
  humidity: { en: "Humidity", hi: "आर्द्रता", kn: "ಆರ್ದ್ರತೆ" },
  wind: { en: "Wind", hi: "हवा", kn: "ಗಾಳಿ" },
  noAdvice: {
    en: "No special advice. Continue normal farm work.",
    hi: "कोई विशेष सलाह नहीं। सामान्य खेती का काम जारी रखें।",
    kn: "ಯಾವುದೇ ವಿಶೇಷ ಸಲಹೆ ಇಲ್ಲ. ಸಾಮಾನ್ಯ ಕೃಷಿ ಕೆಲಸ ಮುಂದುವರಿಸಿ.",
  },
  unreviewed: {
    en: "",
    hi: "अनुवाद की समीक्षा अभी बाकी है",
    kn: "ಅನುವಾದ ಇನ್ನೂ ಪರಿಶೀಲಿಸಲಾಗಿಲ್ಲ",
  },
  demo: {
    en: "Demo data: not a real forecast",
    hi: "डेमो डेटा: असली पूर्वानुमान नहीं",
    kn: "ಡೆಮೊ ಡೇಟಾ: ನಿಜವಾದ ಮುನ್ಸೂಚನೆ ಅಲ್ಲ",
  },
  noForecast: {
    en: "No forecast available yet.",
    hi: "अभी कोई पूर्वानुमान उपलब्ध नहीं है।",
    kn: "ಇನ್ನೂ ಯಾವುದೇ ಮುನ್ಸೂಚನೆ ಲಭ್ಯವಿಲ್ಲ.",
  },
  forCrop: { en: "For", hi: "फसल", kn: "ಬೆಳೆ" },
  allCrops: { en: "All crops", hi: "सभी फसलें", kn: "ಎಲ್ಲಾ ಬೆಳೆಗಳು" },
} as const;

export type StringKey = keyof typeof S;
export const t = (key: StringKey, lang: Lang): string => S[key][lang] || S[key].en;

export const RAIN_NAMES: Record<Lang, string[]> = {
  en: ["No rain", "Very light rain", "Light rain", "Moderate rain", "Heavy rain", "Very heavy rain", "Extremely heavy rain"],
  hi: ["बारिश नहीं", "बहुत हल्की बारिश", "हल्की बारिश", "मध्यम बारिश", "भारी बारिश", "बहुत भारी बारिश", "अत्यधिक भारी बारिश"],
  kn: ["ಮಳೆ ಇಲ್ಲ", "ಅತಿ ಲಘು ಮಳೆ", "ಲಘು ಮಳೆ", "ಸಾಧಾರಣ ಮಳೆ", "ಭಾರೀ ಮಳೆ", "ಅತಿ ಭಾರೀ ಮಳೆ", "ಅತ್ಯಧಿಕ ಭಾರೀ ಮಳೆ"],
};

export const SEVERITY_TEXT: Record<Lang, Record<string, string>> = {
  en: { red: "Take action", orange: "Be prepared", yellow: "Be aware", green: "Good to know" },
  hi: { red: "तुरंत कदम उठाएं", orange: "तैयार रहें", yellow: "सतर्क रहें", green: "जानकारी" },
  kn: { red: "ತಕ್ಷಣ ಕ್ರಮ ಕೈಗೊಳ್ಳಿ", orange: "ಸಿದ್ಧರಾಗಿರಿ", yellow: "ಎಚ್ಚರದಿಂದಿರಿ", green: "ಮಾಹಿತಿ" },
};

export const CROP_NAMES: Record<Lang, Record<string, string>> = {
  en: { paddy: "Paddy", maize: "Maize", soybean: "Soybean", groundnut: "Groundnut", cotton: "Cotton", chickpea: "Chickpea", sorghum: "Rabi sorghum", greengram: "Green gram", wheat: "Wheat" },
  hi: { paddy: "धान", maize: "मक्का", soybean: "सोयाबीन", groundnut: "मूंगफली", cotton: "कपास", chickpea: "चना", sorghum: "रबी ज्वार", greengram: "मूंग", wheat: "गेहूं" },
  kn: { paddy: "ಭತ್ತ", maize: "ಮೆಕ್ಕೆಜೋಳ", soybean: "ಸೋಯಾಬೀನ್", groundnut: "ಶೇಂಗಾ", cotton: "ಹತ್ತಿ", chickpea: "ಕಡಲೆ", sorghum: "ಹಿಂಗಾರು ಜೋಳ", greengram: "ಹೆಸರು", wheat: "ಗೋಧಿ" },
};
