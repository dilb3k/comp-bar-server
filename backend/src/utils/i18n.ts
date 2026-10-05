const translations: Record<string, Record<string, string>> = {
  uz: {
    // Auth
    "Invalid phone number or password": "Telefon raqam yoki parol noto'g'ri",
    "User not found": "Foydalanuvchi topilmadi",
    "Only superAdmin can create admins": "Faqat superAdmin admin yarata oladi",
    "Phone number already exists": "Bunday telefon raqam allaqachon mavjud",
    "Only superAdmin can view admins": "Faqat superAdmin adminlarni ko'ra oladi",
    "Only superAdmin can update admins": "Faqat superAdmin adminlarni tahrirlay oladi",
    "Can only update admin users": "Faqat adminlarni tahrirlash mumkin",
    "Only superAdmin can delete admins": "Faqat superAdmin adminlarni o'chira oladi",
    "Cannot delete yourself": "O'zingizni o'chira olmaysiz",
    "Can only delete admin users": "Faqat adminlarni o'chirish mumkin",
    "Authorization token is required": "Avtorizatsiya tokeni talab qilinadi",
    "Invalid or expired token": "Yaroqsiz yoki muddati o'tgan token",
    "Unauthorized": "Avtorizatsiyadan o'tmagan",
    "Forbidden": "Ta'qiqlangan",

    // Products
    "Product not found": "Mahsulot topilmadi",
    "Deleted product cannot be updated": "O'chirilgan mahsulotni tahrirlash mumkin emas",
    "sellPrice must be greater than or equal to buyPrice": "Sotish narxi kelish narxidan kichik bo'lmasligi kerak",

    // Inventory
    "Inventory cannot be created for a future date": "Kelajak sana uchun ombor yaratib bo'lmaydi",
    "Past business days cannot be edited": "O'tgan ish kunlarini tahrirlash mumkin emas",
    "from must be less than or equal to to": "Boshlang'ich sana tugash sanasidan katta",
    "currentQuantity cannot be greater than startQuantity": "Joriy miqdor boshlang'ich miqdordan ko'p bo'lmasligi kerak",

    // Snapshots
    "Future snapshot dates are not allowed": "Kelajak sanalar uchun snapshot yaratib bo'lmaydi",
    "from must be <= to": "Boshlang'ich sana tugash sanasidan katta",

    // General
    "Route not found": "Yo'nalish topilmadi",
    "Validation failed": "Validatsiyadan o'tmadi",
    "Duplicate value": "Takroriy qiymat",
    "Internal server error": "Serverda xatolik yuz berdi",
  },

  ru: {
    // Auth
    "Invalid phone number or password": "Неверный номер телефона или пароль",
    "User not found": "Пользователь не найден",
    "Only superAdmin can create admins": "Только супер-админ может создавать админов",
    "Phone number already exists": "Такой номер телефона уже существует",
    "Only superAdmin can view admins": "Только супер-админ может просматривать админов",
    "Only superAdmin can update admins": "Только супер-админ может редактировать админов",
    "Can only update admin users": "Можно редактировать только админов",
    "Only superAdmin can delete admins": "Только супер-админ может удалять админов",
    "Cannot delete yourself": "Вы не можете удалить себя",
    "Can only delete admin users": "Можно удалять только админов",
    "Authorization token is required": "Требуется токен авторизации",
    "Invalid or expired token": "Недействительный или просроченный токен",
    "Unauthorized": "Не авторизован",
    "Forbidden": "Запрещено",

    // Products
    "Product not found": "Товар не найден",
    "Deleted product cannot be updated": "Удаленный товар нельзя редактировать",
    "sellPrice must be greater than or equal to buyPrice": "Цена продажи не может быть меньше цены покупки",

    // Inventory
    "Inventory cannot be created for a future date": "Нельзя создать склад на будущую дату",
    "Past business days cannot be edited": "Прошедшие рабочие дни нельзя редактировать",
    "from must be less than or equal to to": "Начальная дата больше конечной",
    "currentQuantity cannot be greater than startQuantity": "Текущее количество не может превышать начальное",

    // Snapshots
    "Future snapshot dates are not allowed": "Нельзя создать снимок на будущую дату",
    "from must be <= to": "Начальная дата больше конечной",

    // General
    "Route not found": "Маршрут не найден",
    "Validation failed": "Ошибка валидации",
    "Duplicate value": "Повторяющееся значение",
    "Internal server error": "Внутренняя ошибка сервера",
  },
};

// Localized traffic-shaping and bounded-work errors.
const capacityMessages: [string, string, string][] = [
  ["Too many login attempts. Please try again after 15 minutes.", "Urinishlar soni ko‘payib ketdi. 15 daqiqadan keyin qayta urinib ko‘ring", "Слишком много попыток. Повторите через 15 минут"],
  ["Read service busy; retry later", "Server band. Birozdan keyin qayta urinib ko‘ring", "Сервер занят. Попробуйте чуть позже"],
  ["Report service busy; retry later", "Hisobot xizmati band. Birozdan keyin qayta urinib ko‘ring", "Сервис отчётов занят. Попробуйте чуть позже"],
  ["Report generation failed", "Hisobotni yaratib bo‘lmadi. Qayta urinib ko‘ring", "Не удалось создать отчёт. Попробуйте ещё раз"],
  ["Report generation timed out", "Hisobot tayyorlash vaqti tugadi. Qisqaroq davrni tanlang", "Время создания отчёта истекло. Выберите более короткий период"],
  ["Report is too large. Choose a shorter date range.", "Hisobot juda katta. Qisqaroq davrni tanlang", "Отчёт слишком большой. Выберите более короткий период"],
  ["Rate limiter unavailable", "Server vaqtincha band. Qayta urinib ko‘ring", "Сервер временно занят. Попробуйте позже"],
  ["Server shutting down", "Server yangilanmoqda. Birozdan keyin qayta urinib ko‘ring", "Сервер обновляется. Попробуйте чуть позже"],
  ["Too many requests. Please try again later.", "So‘rovlar soni ko‘payib ketdi. Keyinroq qayta urinib ko‘ring", "Слишком много запросов. Попробуйте позже"],
  ["Too many image requests. Please try again later.", "Rasm so‘rovlari soni ko‘payib ketdi. Keyinroq urinib ko‘ring", "Слишком много запросов изображений. Попробуйте позже"],
];
for (const [message, uz, ru] of capacityMessages) {
  translations.uz[message] = uz;
  translations.ru[message] = ru;
}

const dynamicPrefixes: Record<string, Record<string, string>> = {
  uz: {
    "Active product not found for productId=": "Faol mahsulot topilmadi (productId=",
    "Inventory start entry not found for productId=": "Ombor yozuvi topilmadi (productId=",
  },
  ru: {
    "Active product not found for productId=": "Активный товар не найден (productId=",
    "Inventory start entry not found for productId=": "Запись склада не найдена (productId=",
  },
};

export function translateMessage(message: string, lang: string): string {
  const langTranslations = translations[lang];
  if (!langTranslations) return message;

  if (langTranslations[message]) return langTranslations[message];

  const prefixes = dynamicPrefixes[lang];
  if (prefixes) {
    for (const [prefix, translation] of Object.entries(prefixes)) {
      if (message.startsWith(prefix)) {
        return message.replace(prefix, translation);
      }
    }
  }

  return message;
}

export function detectLanguage(acceptLanguage?: string): string {
  if (!acceptLanguage) return "uz";
  if (acceptLanguage.startsWith("uz")) return "uz";
  if (acceptLanguage.startsWith("ru")) return "ru";
  return "uz";
}
