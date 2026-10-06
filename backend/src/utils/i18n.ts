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

// Keep internal error messages stable for logs and integrations; translate
// their public text only at the HTTP boundary.
const additionalMessages: [string, string, string][] = [
  ["Invalid username or password", "Login yoki parol noto‘g‘ri", "Неверный логин или пароль"],
  ["Username already exists", "Bu login allaqachon mavjud", "Такой логин уже существует"],
  ["Invalid or expired refresh token", "Sessiya muddati tugagan. Qayta kiring", "Сессия истекла. Войдите снова"],
  ["User account is deactivated", "Hisobingiz bloklangan. Administratorga murojaat qiling", "Аккаунт заблокирован. Обратитесь к администратору"],
  ["Request belongs to another account", "Hisob o‘zgardi. Qayta urinib ko‘ring", "Аккаунт изменился. Повторите попытку"],
  ["Security settings changed; sign in again", "Xavfsizlik sozlamalari o‘zgardi. Qayta kiring", "Настройки безопасности изменились. Войдите снова"],
  ["Authentication service unavailable; retry later", "Kirish xizmati vaqtincha ishlamayapti. Keyinroq urinib ko‘ring", "Сервис входа временно недоступен. Попробуйте позже"],
  ["Cannot deactivate yourself", "O‘z hisobingizni bloklay olmaysiz", "Нельзя заблокировать собственный аккаунт"],
  ["Only superAdmin can view admin stats", "Faqat bosh administrator foydalanuvchilar statistikasini ko‘ra oladi", "Только главный администратор может просматривать статистику пользователей"],
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
  ["Request body is too large", "Yuborilgan ma’lumot hajmi juda katta", "Объём отправленных данных слишком большой"],
  ["Invalid JSON request body", "Yuborilgan ma’lumot formati noto‘g‘ri", "Неверный формат отправленных данных"],
  ["Bot integration is not configured", "Telegram bot vaqtincha mavjud emas", "Telegram-бот временно недоступен"],
  ["Contact ownership proof is required", "Telegram bot orqali o‘z kontaktingizni yuboring", "Отправьте свой контакт через Telegram-бота"],
  ["Ro‘yxatdan o‘tish yopiq.", "Ro‘yxatdan o‘tish yopiq.", "Регистрация закрыта."],
  ["Ro‘yxatdan o‘tish yopiq. Administratorga murojaat qiling.", "Ro‘yxatdan o‘tish yopiq. Administratorga murojaat qiling.", "Регистрация закрыта. Обратитесь к администратору."],
  ["Telefon raqamingizni to‘liq kiriting", "Telefon raqamingizni to‘liq kiriting", "Введите полный номер телефона"],
  ["Bu telefon raqami bilan hisob mavjud. Hisobingizga kiring.", "Bu telefon raqami bilan hisob mavjud. Hisobingizga kiring.", "Аккаунт с этим номером уже существует. Войдите в свой аккаунт."],
  ["Bu Telegram bilan hisob mavjud. Hisobingizga kiring.", "Bu Telegram bilan hisob mavjud. Hisobingizga kiring.", "Аккаунт с этим Telegram уже существует. Войдите в свой аккаунт."],
  ["Telefonni Telegram bot orqali tasdiqlang.", "Telefonni Telegram bot orqali tasdiqlang.", "Подтвердите телефон через Telegram-бота."],
  ["Telefon tasdiqlanmadi yoki muddati tugadi. Botni qayta oching.", "Telefon tasdiqlanmadi yoki muddati tugadi. Botni qayta oching.", "Телефон не подтверждён или срок истёк. Откройте бота снова."],
  ["Tasdiqlash muddati tugadi. Formadan botni qayta oching.", "Tasdiqlash muddati tugadi. Formadan botni qayta oching.", "Срок подтверждения истёк. Откройте бота снова из формы."],
  ["Bu tasdiqlash boshqa raqamga tegishli.", "Bu tasdiqlash boshqa raqamga tegishli.", "Это подтверждение относится к другому номеру."],
  ["Telefon raqami noto‘g‘ri.", "Telefon raqami noto‘g‘ri.", "Неверный номер телефона."],
  ["Telegram hisobi noto‘g‘ri.", "Telegram hisobi noto‘g‘ri.", "Неверный аккаунт Telegram."],
  ["Telegram bot vaqtincha mavjud emas.", "Telegram bot vaqtincha mavjud emas.", "Telegram-бот временно недоступен."],
  ["O‘zingizning kontaktingizni yuboring.", "O‘zingizning kontaktingizni yuboring.", "Отправьте свой контакт."],
  ["Telefon egaligini Telegram botidagi kontakt yuborish orqali tasdiqlang yoki administratorga murojaat qiling", "Telefon egaligini Telegram botidagi kontakt yuborish orqali tasdiqlang yoki administratorga murojaat qiling", "Подтвердите номер, отправив свой контакт в Telegram-боте, или обратитесь к администратору"],
  ["Telefon tasdiqlanmadi yoki hisob boshqa Telegramga bog‘langan", "Telefon tasdiqlanmadi yoki hisob boshqa Telegramga bog‘langan", "Телефон не подтверждён или аккаунт связан с другим Telegram"],
  ["Telegram kodi yetkazilmadi. Keyinroq qayta urinib ko‘ring", "Telegram kodi yetkazilmadi. Keyinroq qayta urinib ko‘ring", "Не удалось доставить код в Telegram. Попробуйте позже"],
  ["Kod muddati tugagan yoki yaroqsiz. Qaytadan kiring.", "Kod muddati tugagan yoki yaroqsiz. Qaytadan kiring.", "Код недействителен или истёк. Войдите снова."],
  ["Urinishlar soni tugadi. Qaytadan kiring.", "Urinishlar soni tugadi. Qaytadan kiring.", "Попытки закончились. Войдите снова."],
  ["Kod boshqa qurilma uchun yaratilgan", "Kod boshqa qurilma uchun yaratilgan", "Код создан для другого устройства"],
  ["Kod parol almashtirilishidan oldin yaratilgan", "Kod parol almashtirilishidan oldin yaratilgan", "Код создан до смены пароля"],
  ["Bu kod allaqachon ishlatilgan.", "Bu kod allaqachon ishlatilgan.", "Этот код уже использован."],
  ["Sessiya boshqa qurilmada ochildi. Qayta kiring.", "Sessiya boshqa qurilmada ochildi. Qayta kiring.", "Вход выполнен на другом устройстве. Войдите снова."],
  ["Boshqa qurilmadan kirish tasdiqlangani sababli ushbu sessiya yakunlandi.", "Boshqa qurilmadan kirish tasdiqlangani sababli ushbu sessiya yakunlandi.", "Сессия завершена после подтверждения входа на другом устройстве."],
  ["Hisob xavfsizlik sozlamalari o‘zgardi; qayta kiring", "Hisob xavfsizlik sozlamalari o‘zgardi; qayta kiring", "Настройки безопасности аккаунта изменились. Войдите снова"],
  ["Havola ishlatilgan yoki muddati tugagan. Telegram botidan yangi havola oling.", "Havola ishlatilgan yoki muddati tugagan. Telegram botidan yangi havola oling.", "Ссылка использована или истекла. Получите новую ссылку в Telegram-боте."],
  ["Yangi havola olish uchun 1 daqiqa kutib, qayta bosing.", "Yangi havola olish uchun 1 daqiqa kutib, qayta bosing.", "Подождите одну минуту и запросите новую ссылку."],
  ["Tasdiqlash ishlatilgan yoki muddati tugagan. Telegram botida tiklashni qayta boshlang.", "Tasdiqlash ishlatilgan yoki muddati tugagan. Telegram botida tiklashni qayta boshlang.", "Подтверждение использовано или истекло. Начните восстановление заново в Telegram-боте."],
  ["Tiklashni qayta boshlash uchun 1 daqiqa kuting.", "Tiklashni qayta boshlash uchun 1 daqiqa kuting.", "Подождите одну минуту, чтобы начать восстановление заново."],
  ["Hisobingizni avval /start orqali ulang. Bir nechta hisob bog‘langan bo‘lsa, yordamga murojaat qiling.", "Hisobingizni avval /start orqali ulang. Bir nechta hisob bog‘langan bo‘lsa, yordamga murojaat qiling.", "Сначала привяжите аккаунт через /start. Если привязано несколько аккаунтов, обратитесь за помощью."],
  ["Parol kamida 6 belgi va ko‘pi bilan 72 bayt bo‘lsin.", "Parol kamida 6 belgi va ko‘pi bilan 72 bayt bo‘lsin.", "Пароль должен содержать минимум 6 символов и занимать не более 72 байт."],
  ["password must be at most 72 bytes", "Parol hajmi 72 baytdan oshmasligi kerak", "Пароль не должен занимать более 72 байт"],
  ["username must be at least 3 characters", "Login kamida 3 belgidan iborat bo‘lishi kerak", "Логин должен содержать минимум 3 символа"],
  ["username is required", "Loginni kiriting", "Введите логин"],
  ["password is required", "Parolni kiriting", "Введите пароль"],
  ["sessionChallengeId is required", "Tasdiqlash ma’lumotlari yo‘q. Qayta kiring", "Нет данных подтверждения. Войдите снова"],
  ["otpCode must be 6 digits", "6 xonali tasdiqlash kodini kiriting", "Введите шестизначный код подтверждения"],
  ["Telefon raqamingizni kiriting", "Telefon raqamingizni kiriting", "Введите свой номер телефона"],
  ["password must be at least 6 characters", "Parol kamida 6 belgidan iborat bo‘lishi kerak", "Пароль должен содержать минимум 6 символов"],
  ["phone_number is required", "Telefon raqamini kiriting", "Введите номер телефона"],
  ["refreshToken is required", "Sessiya ma’lumotlari yo‘q. Qayta kiring", "Нет данных сессии. Войдите снова"],
  ["name is required", "Nomni kiriting", "Введите имя или название"],
  ["amount must be >= 0", "Summa manfiy bo‘lishi mumkin emas", "Сумма не может быть отрицательной"],
  ["amount must be positive", "Summa 0 dan katta bo‘lishi kerak", "Сумма должна быть больше 0"],
  ["buyPrice must be >= 0", "Xarid narxi manfiy bo‘lishi mumkin emas", "Цена покупки не может быть отрицательной"],
  ["sellPrice must be >= 0", "Sotish narxi manfiy bo‘lishi mumkin emas", "Цена продажи не может быть отрицательной"],
  ["date must be YYYY-MM-DD", "Sanani YYYY-MM-DD shaklida kiriting", "Введите дату в формате YYYY-MM-DD"],
  ["quantity must be > 0", "Miqdor 0 dan katta bo‘lishi kerak", "Количество должно быть больше 0"],
  ["quantity must be >= 0", "Miqdor manfiy bo‘lishi mumkin emas", "Количество не может быть отрицательным"],
  ["Future dates are not allowed", "Kelajak sana uchun amal bajarib bo‘lmaydi", "Нельзя выполнить операцию на будущую дату"],
  ["Debtor not found", "Qarzdor topilmadi", "Должник не найден"],
  ["Debtor not found or subtraction exceeds outstanding debt", "Qarzdor topilmadi yoki to‘lov qarz summasidan katta", "Должник не найден или платёж превышает сумму долга"],
  ["Invalid amount", "Summa noto‘g‘ri", "Неверная сумма"],
  ["Procurement not found", "Kirim topilmadi", "Поступление не найдено"],
  ["At least one item is required", "Kamida bitta mahsulot qo‘shing", "Добавьте хотя бы один товар"],
  ["Product no longer exists", "Mahsulot endi mavjud emas", "Товар больше не существует"],
  ["Deleted product IDs cannot be reused", "O‘chirilgan mahsulot identifikatorini qayta ishlatib bo‘lmaydi", "Нельзя повторно использовать идентификатор удалённого товара"],
  ["Ushbu barcode allaqachon boshqa mahsulotda ishlatilmoqda", "Bu shtrix-kod boshqa mahsulotda ishlatilmoqda", "Этот штрихкод уже используется другим товаром"],
  ["Dona miqdori butun son bo'lishi kerak", "Dona miqdori butun son bo‘lishi kerak", "Количество в штуках должно быть целым числом"],
  ["Qo'shiladigan miqdor 0 dan katta bo'lishi kerak", "Qo‘shiladigan miqdor 0 dan katta bo‘lishi kerak", "Добавляемое количество должно быть больше 0"],
  ["Qo'shiladigan miqdor kamida 1 dona bo'lishi kerak", "Qo‘shiladigan miqdor kamida 1 dona bo‘lishi kerak", "Добавляемое количество должно быть не меньше 1 штуки"],
  ["Miqdor 0 dan katta bo'lishi kerak", "Miqdor 0 dan katta bo‘lishi kerak", "Количество должно быть больше 0"],
  ["Miqdor kamida 1 dona bo'lishi kerak", "Miqdor kamida 1 dona bo‘lishi kerak", "Количество должно быть не меньше 1 штуки"],
  ["currentQuantity cannot be greater than product quantity", "Joriy miqdor mahsulot qoldig‘idan katta bo‘lishi mumkin emas", "Текущее количество не может превышать остаток товара"],
  ["deltaQuantity must be a positive number", "Qo‘shiladigan miqdor musbat son bo‘lishi kerak", "Добавляемое количество должно быть положительным"],
  ["from and to required", "Boshlanish va tugash sanalarini kiriting", "Укажите начальную и конечную даты"],
  ["custom period requires from and to", "Boshlanish va tugash sanalarini kiriting", "Укажите начальную и конечную даты"],
  ["Invalid or excessive date range", "Sana oralig‘i noto‘g‘ri yoki juda katta", "Неверный или слишком большой диапазон дат"],
  ["Range cannot exceed ten years", "Sana oralig‘i 10 yildan oshmasligi kerak", "Диапазон дат не должен превышать 10 лет"],
  ["Unsupported image type", "Bu rasm formati qo‘llab-quvvatlanmaydi", "Этот формат изображения не поддерживается"],
  ["Image not found", "Rasm topilmadi", "Изображение не найдено"],
  ["Image storage is not configured", "Rasm saqlash xizmati vaqtincha mavjud emas", "Сервис хранения изображений временно недоступен"],
  ["image file is required (multipart field name: image)", "Rasm faylini tanlang", "Выберите файл изображения"],
  ["receipt image file is required (multipart field name: receipt)", "Chek rasmini tanlang", "Выберите изображение чека"],
  ["File too large", "Fayl hajmi juda katta", "Файл слишком большой"],
  ["Too many files", "Fayllar soni juda ko‘p", "Слишком много файлов"],
  ["Unexpected field", "Kutilmagan fayl yoki maydon yuborildi", "Отправлен неожиданный файл или поле"],
  ["Too many fields", "Maydonlar soni juda ko‘p", "Слишком много полей"],
  ["Too many parts", "Yuborilgan qismlar soni juda ko‘p", "Слишком много частей запроса"],
  ["Field name too long", "Maydon nomi juda uzun", "Имя поля слишком длинное"],
  ["Field value too long", "Maydon qiymati juda uzun", "Значение поля слишком длинное"],
  ["A stable operation ID is required", "Amal identifikatori talab qilinadi. Qayta urinib ko‘ring", "Требуется идентификатор операции. Повторите попытку"],
  ["Operation ID was already used for a different request", "Bu amal identifikatori boshqa so‘rovda ishlatilgan", "Идентификатор операции уже использован в другом запросе"],
  ["Operation is still being processed", "Amal hali bajarilmoqda. Biroz kuting", "Операция ещё выполняется. Подождите немного"],
  ["Ma’lumot boshqa qurilmada o‘zgargan. Qayta yuklang; yuborilmagan amal saqlanadi.", "Ma’lumot boshqa qurilmada o‘zgargan. Qayta yuklang; yuborilmagan amal saqlanadi.", "Данные изменены на другом устройстве. Обновите страницу; неотправленная операция сохранена."],
  ["Stock count, cost or unit changed; reconcile the saved operation", "Qoldiq, narx yoki o‘lchov birligi o‘zgardi. Saqlangan amalni tekshiring", "Остаток, цена или единица измерения изменились. Проверьте сохранённую операцию"],
  ["Stock projections disagree; reconcile before procurement", "Qoldiq ma’lumotlari mos kelmayapti. Kirimdan oldin tekshiring", "Данные об остатках не совпадают. Проверьте их перед поступлением"],
  ["Stock projections disagree; reconcile before restocking", "Qoldiq ma’lumotlari mos kelmayapti. Mahsulot qo‘shishdan oldin tekshiring", "Данные об остатках не совпадают. Проверьте их перед пополнением"],
  ["Stock projections disagree; reconciliation required", "Qoldiq ma’lumotlari mos kelmayapti. Ularni tekshirish kerak", "Данные об остатках не совпадают. Требуется сверка"],
  ["Late sale conflicts with later stock; operation retained for review", "Oldingi savdo keyingi qoldiq bilan mos kelmayapti. Amal tekshirish uchun saqlandi", "Продажа за прошлый период не соответствует последующим остаткам. Операция сохранена для проверки"],
  ["Legacy operation receipt cannot verify this intent; retain it for reconciliation", "Eski amal yozuvi bilan tasdiqlab bo‘lmadi. Amal tekshirish uchun saqlanadi", "Нельзя подтвердить операцию по старой записи. Она сохранена для сверки"],
  ["Legacy product creation requires reviewed migration; original client queue must be retained", "Eski mahsulot yozuvini tekshirish kerak. Yuborilmagan amallar saqlanadi", "Старую запись товара нужно проверить. Очередь неотправленных операций сохранена"],
  ["Update client to submit the sale cost, unit and stock baseline", "Savdoni yuborish uchun ilovani yangilang", "Обновите приложение для отправки продажи"],
  ["Invalid sync cursor; start a fresh pull", "Sinxronlashni qaytadan boshlash kerak", "Нужно начать синхронизацию заново"],
  ["Server revision moved backwards; start a fresh pull", "Server ma’lumotlari o‘zgardi. Sinxronlashni qaytadan boshlang", "Данные сервера изменились. Начните синхронизацию заново"],
  ["Sync scope changed; restart pull", "Sinxronlash doirasi o‘zgardi. Qayta boshlang", "Область синхронизации изменилась. Начните заново"],
  ["Expected completed checkpoint", "Sinxronlash tugallanmagan. Qayta urinib ko‘ring", "Синхронизация не завершена. Повторите попытку"],
  ["Payment required", "Pullik tarif kerak", "Требуется платный тариф"],
  ["Payment required. Please contact admin to activate premium features.", "Pullik imkoniyatlarni yoqish uchun administratorga murojaat qiling", "Для подключения платных функций обратитесь к администратору"],
  ["Only superAdmin can manage subscriptions", "Faqat bosh administrator tariflarni boshqara oladi", "Только главный администратор может управлять подписками"],
  ["Cannot manage superAdmin subscription", "Bosh administrator tarifini o‘zgartirib bo‘lmaydi", "Нельзя изменить подписку главного администратора"],
  ["Subscription changed", "Tarif o‘zgardi. Ma’lumotlarni yangilang", "Подписка изменилась. Обновите данные"],
  ["Subscription period is required", "Tarif muddatini tanlang", "Выберите срок подписки"],
  ["Payment not found", "To‘lov topilmadi", "Платёж не найден"],
  ["Payment not found for this Telegram account", "Bu Telegram hisobiga tegishli to‘lov topilmadi", "Платёж для этого аккаунта Telegram не найден"],
  ["Payment is not pending", "Bu to‘lov allaqachon ko‘rib chiqilgan", "Этот платёж уже рассмотрен"],
  ["Payment method mismatch", "To‘lov usuli mos kelmayapti", "Способ оплаты не совпадает"],
  ["Payment already reviewed or receipt already attached", "To‘lov ko‘rib chiqilgan yoki chek allaqachon biriktirilgan", "Платёж уже рассмотрен или чек уже прикреплён"],
  ["Payment cannot accept another receipt", "Bu to‘lovga boshqa chek biriktirib bo‘lmaydi", "К этому платежу нельзя прикрепить ещё один чек"],
  ["Linked payment account does not match", "To‘lovga bog‘langan hisob mos kelmayapti", "Аккаунт, связанный с платежом, не совпадает"],
  ["Payment grant identity mismatch", "To‘lov tasdiqlash ma’lumotlari mos kelmayapti", "Данные подтверждения платежа не совпадают"],
  ["Legacy OCR grant requires reconciliation before approval", "Eski chek ma’lumotlarini tasdiqlashdan oldin tekshiring", "Проверьте данные старого чека перед подтверждением"],
  ["Active Pro period cannot be overwritten by a Bor payment; review required", "Faol Pro tarifini Bor to‘lovi bilan almashtirib bo‘lmaydi. To‘lovni tekshiring", "Платёж Bor не может заменить действующий тариф Pro. Проверьте платёж"],
  ["Click is not configured yet", "Click to‘lov xizmati hozircha mavjud emas", "Оплата через Click пока недоступна"],
  ["Click transaction/prepare identity mismatch", "Click to‘lov ma’lumotlari mos kelmayapti", "Данные платежа Click не совпадают"],
  ["Completed payment cannot be cancelled by a stale callback", "Tasdiqlangan to‘lovni eski so‘rov bilan bekor qilib bo‘lmaydi", "Нельзя отменить подтверждённый платёж устаревшим запросом"],
  ["Bor tarifida maksimal 100 ta mahsulot yaratish mumkin. Pro tarifiga o'tish uchun administrator bilan bog'laning.", "Bor tarifida maksimal 100 ta mahsulot yaratish mumkin. Pro tarifiga o‘tish uchun administrator bilan bog‘laning.", "В тарифе Bor можно создать максимум 100 товаров. Для перехода на Pro обратитесь к администратору."],
  ["Bu davr uchun hisobot faqat pullik tarif egalari uchun mavjud", "Bu davr uchun hisobot faqat pullik tarif egalari uchun mavjud", "Отчёт за этот период доступен только на платном тарифе"],
];
for (const [message, uz, ru] of additionalMessages) {
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

  const invalidCode = /^Kod noto'g'ri\. Qolgan urinishlar: (\d+)$/.exec(message);
  if (invalidCode) return lang === "ru" ? `Неверный код. Осталось попыток: ${invalidCode[1]}` : `Kod noto‘g‘ri. Qolgan urinishlar: ${invalidCode[1]}`;
  const product = /^Product not found: (.+)$/.exec(message);
  if (product) return `${lang === "ru" ? "Товар не найден" : "Mahsulot topilmadi"}: ${product[1]}`;
  const barcode = /^"(.+)" mahsuloti allaqachon bu barcode dan foydalanmoqda$/.exec(message);
  if (barcode) return lang === "ru" ? `Товар «${barcode[1]}» уже использует этот штрихкод` : `«${barcode[1]}» mahsuloti bu shtrix-koddan foydalanmoqda`;
  const whole = /^"(.+)" dona bilan o'lchanadi — miqdor butun son bo'lishi kerak$/.exec(message);
  if (whole && lang === "ru") return `Товар «${whole[1]}» измеряется в штуках — количество должно быть целым числом`;
  const sold = /^Sotilgan miqdor \((.+)\) qoldiqdan \((.+)\) ko'p bo'lishi mumkin emas$/.exec(message);
  if (sold && lang === "ru") return `Проданное количество (${sold[1]}) не может превышать остаток (${sold[2]})`;

  if (message === "Required") return lang === "ru" ? "Обязательное поле" : "Bu maydonni to‘ldiring";
  const stringSize = /^String must contain (at least|at most) (\d+) character\(s\)$/.exec(message);
  if (stringSize) return lang === "ru"
    ? `Введите ${stringSize[1] === "at least" ? "не менее" : "не более"} ${stringSize[2]} символов`
    : `${stringSize[1] === "at least" ? "Kamida" : "Ko‘pi bilan"} ${stringSize[2]} belgi kiriting`;
  const precision = /^quantity supports at most (\d+) decimals$/.exec(message);
  if (precision) return lang === "ru" ? `Количество может содержать не более ${precision[1]} знаков после запятой` : `Miqdor kasr qismida ko‘pi bilan ${precision[1]} ta raqam bo‘lishi mumkin`;
  const numericSize = /^Number must be (greater|less) than( or equal to)? (.+)$/.exec(message);
  if (numericSize) {
    const sign = numericSize[1] === "greater" ? (numericSize[2] ? "≥" : ">") : (numericSize[2] ? "≤" : "<");
    return lang === "ru" ? `Число должно быть ${sign} ${numericSize[3]}` : `Son ${sign} ${numericSize[3]} bo‘lishi kerak`;
  }
  if (message.startsWith("Expected ")) return lang === "ru" ? "Неверный тип значения" : "Qiymat turi noto‘g‘ri";
  if (message.startsWith("Invalid enum value.") || message.startsWith("Invalid literal value,")) return lang === "ru" ? "Выберите допустимое значение" : "Ruxsat etilgan qiymatni tanlang";
  if (message.startsWith("Invalid ")) return lang === "ru" ? "Неверный формат значения" : "Qiymat formati noto‘g‘ri";
  const arraySize = /^Array must contain (at least|at most) (\d+) element\(s\)$/.exec(message);
  if (arraySize) return lang === "ru" ? `Количество элементов: ${arraySize[1] === "at least" ? "не менее" : "не более"} ${arraySize[2]}` : `Elementlar soni ${arraySize[1] === "at least" ? "kamida" : "ko‘pi bilan"} ${arraySize[2]} bo‘lishi kerak`;

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
  const preferences = (acceptLanguage ?? "").split(",").map((entry, index) => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="));
    return { lang: tag.split("-")[0], quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(item => ["uz", "ru"].includes(item.lang) && Number.isFinite(item.quality) && item.quality > 0 && item.quality <= 1);
  preferences.sort((a, b) => b.quality - a.quality || a.index - b.index);
  return preferences[0]?.lang ?? "uz";
}
