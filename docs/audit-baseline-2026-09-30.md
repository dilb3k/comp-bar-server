> Historical audit baseline. Subsequent remediation changes are not reflected here. See ../../CLAUDE_CODE_HANDOFF.md and reliability-remediation.md.

# Hisvex: chuqur read-only audit

Sana: 2026-09-30. Tekshirilgan holat: lokal checkoutlar; productionga so‘rov/eksploit yuborilmadi, real MongoDB/R2/Telegram/Click holati o‘zgartirilmadi. Loyiha fayllari tahrirlanmadi. Bu hisobot loyihadan tashqarida saqlangan.

## Qamrov va dalil darajasi

Auth/session/OTP, tenant chegaralari, inventory/sales/snapshot, product image storage, offline queue va sync, subscription/payment/OCR/Click, Web proxy, Electron, Mobile bootstrap, Bot, Landing download/version oqimi hamda deploy konfiguratsiyasi ko‘rildi. Source va lockfilelar o‘qildi; dependency CVE bazasi bo‘yicha to‘liq skan bajarilmadi. Tashqi hujjatlarni olish urinishlari javobsiz qoldi; hisobotdagi dalillar lokal kod va lokal in-memory tekshiruvlarga tayangan.

P1 — xavfsizlik, moliyaviy yaxlitlik yoki muhim ishlashga ta’siri sabab birinchi tuzatish navbati. P2 — muayyan sharoitda noto‘g‘ri ishlash, nosozlik yoki himoya zaifligi. Bular CVSS ballari emas. Har bir topilmaning sharti quyida ko‘rsatilgan. Barcha mumkin bo‘lgan buglar tugadi yoki ekspluatatsiya productionda sodir bo‘lgan degan xulosa berilmaydi.

## Tekshirilgan versiyalar

| Repo | HEAD | Boshlanishda mavjud lokal holat |
|---|---|---|
| comp-bar-server | 2d79745 | clean |
| hisvex-web | c97b5152 | clean |
| desktop | 694b5ab | untracked app.json |
| media-project-mobile | 3872e80 | app/login.tsx va src/components/HisvexSplashScreen.tsx modified |
| hisvex-bot | 01f55e1 | clean |
| hisvex-landing | 45534b0 | clean |

Yakuniy git status yuqoridagi boshlang‘ich holatga mos. hisvex-web/vercel.json dagi eski rewrite allaqachon olib tashlangan; u amaldagi xato deb qayd qilinmadi.

## Lokal tekshiruv natijalari

Productionga ulanmay, vaqtinchalik xotira obyektlari/custom adapterlar bilan tekshirildi. Test fayli qo‘shilmadi, loyiha test/build/migration scriptlari ishga tushirilmadi.

| Tekshiruv | Kuzatilgan natija |
|---|---|
| O‘rnatilgan Zod: coerce.boolean("false") | true |
| PaymentModel yangi obyekt | receiptHash maydoni mavjud, qiymati null; schema indeksi unique+sparse |
| Response(ArrayBuffer(0), status) | 200 OK; 204/205/304 TypeError |
| O‘rnatilgan Axios + shu default/interceptor | timeout 0; FormData JSON {"image":{}} ga aylandi |
| Haqiqiy withIdempotency + xotiradagi model | bir kalit, 2 parallel request, 2 fn bajarilishi, 1 key |
| Haqiqiy getOrCreateKey + xotiradagi storage | birinchi 2 parallel chaqiruv 2 xil kalit yaratdi; faqat 1 tasi saqlangan kalitga mos |

## Topilmalar

### F01 · P1 · Bot orqali boshqa hisobning Telegram bog‘lanishini egallash

Botga jabrlanuvchining telefon raqamini oddiy matn qilib yuborish yetarli: raqam egasi ekanligi tasdiqlanmasdan lookup va linkTelegram ishlaydi. Backend mavjud telegramId ni almashtiradi. Natija: hisobning botdagi obuna/to‘lov ma’lumotlari ochiladi va keyingi login OTP hujumchining Telegramiga boradi. Ilovaga kirish uchun parol hali ham kerak. Tuzatish: raqam egaligini tasdiqlovchi challenge va mavjud bog‘lanishni almashtirish uchun alohida tasdiq.

Dalil: [hisvex-bot/src/bot/bot.ts:76](/Users/dilbek/Desktop/hisvex/hisvex-bot/src/bot/bot.ts:76), [hisvex-bot/src/bot/handlers/start.ts:41](/Users/dilbek/Desktop/hisvex/hisvex-bot/src/bot/handlers/start.ts:41), [comp-bar-server/backend/src/modules/auth/auth.repository.ts:30](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.repository.ts:30).

### F02 · P1 · OTP himoyasini eski verify-phone endpoint orqali chetlab o‘tish

Login PHONE_OTP talab qilgan hisobda ham loginWithPhoneVerification faqat username, password va telefon raqamining tengligini tekshiradi. OTP challenge talab qilinmaydi; yangi sessiya va trusted device yaratiladi. Telefon raqamini bilish uni boshqarishni isbotlamaydi. Tuzatish: OTP talab qilinadigan hisob uchun barcha login yo‘llarida bir xil server-side challenge siyosati.

Dalil: [comp-bar-server/backend/src/modules/auth/auth.service.ts:133](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:133), [comp-bar-server/backend/src/modules/auth/auth.service.ts:191](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:191), [comp-bar-server/backend/src/modules/auth/auth.routes.ts:1](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.routes.ts:1).

### F03 · P1 · R2 dagi boshqa mahsulot yoki chek rasmini o‘chirish mumkin

Product.imageUrl mijozdan qabul qilinadi. Shu URL o‘zgartirilganda/o‘chirilganda server bucket ichidagi obyektni ownership tekshirmasdan o‘chiradi. Boshqa hisob obyektining URLini bilgan admin uni o‘z mahsulotiga yozib, so‘ng tozalashi mumkin. Bundan tashqari bir xil rasm products/<hash>.webp kalitini bo‘lishadi: odatiy o‘chirish ham boshqa mahsulot rasmini buzadi. Tuzatish: server boshqaradigan asset ID, egasi tekshiruvi va reference hisoblash.

Dalil: [comp-bar-server/backend/src/modules/products/product.validation.ts:44](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.validation.ts:44), [comp-bar-server/backend/src/modules/products/product.service.ts:48](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.service.ts:48), [comp-bar-server/backend/src/modules/products/product.service.ts:579](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.service.ts:579), [comp-bar-server/backend/src/lib/r2.ts:69](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/lib/r2.ts:69), [comp-bar-server/backend/src/utils/image-processing.ts:45](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/utils/image-processing.ts:45).

### F04 · P1 · Obuna bekor bo‘lgandan keyin eski JWT pullik huquqlarni saqlaydi

authenticate foydalanuvchini bazadan o‘qiydi, lekin isPayed va tier ni JWT payloadidan oladi. requirePayment shu eski tier ga ishonadi. Obunani bekor qilish sessiyani almashtirmaydi; default access-token muddati 7 kun. Demak downgrade/expiry darhol kuchga kirmaydi. Tuzatish: joriy entitlementni tekshirish yoki token/session versiyasini invalidatsiya qilish.

Dalil: [comp-bar-server/backend/src/modules/auth/auth.middleware.ts:97](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.middleware.ts:97), [comp-bar-server/backend/src/modules/auth/auth.middleware.ts:136](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.middleware.ts:136), [comp-bar-server/backend/src/config/env.ts:15](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/config/env.ts:15), [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:171](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:171).

### F05 · P1 · Parol almashtirish eski sessiya va refresh tokenni bekor qilmaydi

updateAdmin parolni yangilaydi, ammo activeSessionId va verifiedDeviceIds ni o‘zgartirmaydi. Refresh faqat sessionId mosligini tekshiradi. O‘g‘irlangan sessiya parol resetidan keyin ham ishlashi mumkin. Tuzatish: parol o‘zgarganda sessiya versiyasini almashtirish va kerakli trusted-device yozuvlarini bekor qilish.

Dalil: [comp-bar-server/backend/src/modules/auth/auth.service.ts:484](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:484), [comp-bar-server/backend/src/modules/auth/auth.repository.ts:88](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.repository.ts:88), [comp-bar-server/backend/src/modules/auth/auth.service.ts:345](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:345), [comp-bar-server/backend/src/modules/auth/user.model.ts:117](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/user.model.ts:117).

### F06 · P1 · Blok PIN serverda himoya chegarasi emas; Mobile restartda uni yo‘qotadi

blockCode ochiq qiymat sifatida user/JWTga chiqariladi; updateMe eski PINsiz uni almashtirish yoki null qilishni qabul qiladi. Muhim product/debtor/inventory amallari backendda PIN talab qilmaydi. Mobile bootstrap userData ga blockCode ni ko‘chirmaydi, initial store esa null. Demak UI PINini API orqali chetlab o‘tish, Mobile restartda esa himoyani yo‘qotish mumkin. Tuzatish: PIN maqsadini aniqlab, serverda alohida tasdiqlangan amal va clientda to‘liq hydration.

Dalil: [comp-bar-server/backend/src/modules/auth/auth.service.ts:54](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:54), [comp-bar-server/backend/src/modules/auth/auth.service.ts:537](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.service.ts:537), [comp-bar-server/backend/src/modules/auth/user.model.ts:106](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/user.model.ts:106), [media-project-mobile/app/_layout.tsx:141](/Users/dilbek/Desktop/hisvex/media-project-mobile/app/_layout.tsx:141), [media-project-mobile/src/store/index.ts:292](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:292).

### F07 · P2 · Statistika paywallini boshqa API yo‘llari orqali chetlab o‘tish

Snapshot range pullik cheklovga ega, lekin getDaily faqat kelajak sanasini tekshiradi. Sync ham tarixiy inventory va daily yozuvlarini tier bo‘yicha cheklamay qaytaradi. Tekin hisob o‘z tarixini shu yo‘llardan olishi mumkin. Bu boshqa hisobga kirish emas, monetizatsiya chegarasidagi nomuvofiqlik. Tuzatish: ma’lumot darajasida yagona entitlement siyosati.

Dalil: [comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:36](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:36), [comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:59](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:59), [comp-bar-server/backend/src/modules/sync/sync.service.ts:303](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:303).

### F08 · P1 — credential faol bo‘lsa · Workspace fayllarida DB credential va admin backup mavjud

.claude/settings.local.json ning 54–55-qatorlarida username:password shaklidagi MongoDB URI topildi. admin-backup.json da bitta user hujjati, bcrypt password hash va shaxsiy/sessiya maydonlari bor. Ikkala fayl mode 0644; katalog ACLlari va credentialning amaldaligi tekshirilmadi. Sirlarning o‘zi hisobotga chiqarilmadi va ulardan foydalanilmadi. Gitga yoki internetga sizganligi isbotlanmadi. Tuzatish: faol credentialni rotatsiya qilish, buyruq allow-listidan sirni chiqarish va backup kirishini cheklash.

Dalil: [.claude/settings.local.json:54](/Users/dilbek/Desktop/hisvex/.claude/settings.local.json:54), [admin-backup.json:1](/Users/dilbek/Desktop/hisvex/admin-backup.json:1).

### F09 · P1 · Idempotency parallel so‘rovlarni takror bajaradi

Kalit avval o‘qiladi, keyin biznes fn bajariladi, faqat undan keyin kalit yoziladi. Bir kalit bilan ikkita parallel chaqiruv ikkala fn ni ham bajaradi; unique-index xatosi faqat natijani birlashtiradi. Haqiqiy service kodi in-memory model bilan tekshirildi: 2 so‘rov → 2 biznes bajarilishi → 1 saqlangan kalit. Tuzatish: operatsiyadan oldin atomik claim va biznes yozuvi bilan bir tranzaksiyada natija.

Dalil: [comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:25](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:25), [comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:40](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:40).

### F10 · P1 · Failover yozuvchi so‘rovlarni ko‘r-ko‘rona qaytaradi

Web proxy va Desktop/Mobile/Bot interceptorlari failoverda POST/PUT/PATCHni ham takrorlaydi. Birinchi server yozuvni commit qilib, javob yo‘qolgan bo‘lishi mumkin. Desktop/Mobile sales yuborishlarida idempotencyKey yo‘q; debtor adjust, restock va ayrim payment yozuvlarida ham umumiy dedup yo‘q. Natija: ikki marta savdo, kirim, qarz yoki to‘lov yozuvi. Tuzatish: barqaror operation ID va atomik dedup bo‘lgan amallargagina avtomatik retry.

Dalil: [hisvex-web/src/app/api/[...path]/route.ts:115](/Users/dilbek/Desktop/hisvex/hisvex-web/src/app/api/[...path]/route.ts:115), [desktop/src/api/client.ts:229](/Users/dilbek/Desktop/hisvex/desktop/src/api/client.ts:229), [media-project-mobile/src/api/client.ts:431](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:431), [hisvex-bot/src/services/api-client.ts:84](/Users/dilbek/Desktop/hisvex/hisvex-bot/src/services/api-client.ts:84), [comp-bar-server/backend/src/modules/debtors/debtor.service.ts:52](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/debtors/debtor.service.ts:52).

### F11 · P1 · Savdo commit bo‘lgach xato qaytishi va qayta hisoblanishi mumkin

Inventory transaction tugaganidan keyin snapshotService.createOrUpdate/getDaily chaqiriladi. Shu bosqichdagi xato, jumladan business-day almashishi, mijozga error beradi, lekin savdo allaqachon bazada. Idempotency kaliti esa fn muvaffaqiyatli qaytgach yoziladi. Retry savdoni yana bajaradi. Tuzatish: savdo va operation natijasini atomik saqlash; snapshotni shu tranzaksiyaga yoki qayta bajarilishi xavfsiz projection jarayoniga ko‘chirish.

Dalil: [comp-bar-server/backend/src/modules/inventory/inventory.service.ts:809](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/inventory/inventory.service.ts:809), [comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:30](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/idempotency/idempotency.service.ts:30), [comp-bar-server/backend/src/modules/inventory/inventory.controller.ts:63](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/inventory/inventory.controller.ts:63).

### F12 · P1 · Sync rad etgan eski inventory Product.quantity ni baribir buzadi

Inventory repository eski updatedAt bo‘lsa joriy yozuvni qaytaradi. Sync bu natijani ishlatmay, barcha incoming inventory.currentQuantity qiymatlarini mahsulotga yozadi. Misol: server current=8 @12:10; client current=10 @12:00. Inventory 8 qoladi, Product.quantity 10 bo‘ladi. Tuzatish: faqat amalda qabul qilingan yozuvdan quantity mirror qilish.

Dalil: [comp-bar-server/backend/src/modules/inventory/inventory.repository.ts:185](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/inventory/inventory.repository.ts:185), [comp-bar-server/backend/src/modules/sync/sync.service.ts:156](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:156), [comp-bar-server/backend/src/modules/sync/sync.service.ts:167](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:167), [comp-bar-server/backend/src/modules/products/product.repository.ts:180](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.repository.ts:180).

### F13 · P1 · Ikki offline qurilma savdolari bir-birini bosib ketadi

Sync savdo hodisalari o‘rniga absolut qoldiq va LWW updatedAt yuboradi. 10 dona qoldiqdan bir qurilma 2, boshqasi 3 sotganda 8 va 7 keladi; yakun 5 emas, oxirgi yozuv 7 yoki 8 bo‘ladi. Bitta online sessiya siyosati avval yig‘ilgan offline navbatlarni yo‘q qilmaydi. Tuzatish: har savdo uchun noyob, append-only operatsiya va serverda delta qo‘llash.

Dalil: [comp-bar-server/backend/src/modules/inventory/inventory.repository.ts:185](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/inventory/inventory.repository.ts:185), [comp-bar-server/backend/src/modules/sync/sync.service.ts:156](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:156), [desktop/src/store/syncEngine.ts:168](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:168), [media-project-mobile/src/store/index.ts:1313](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:1313).

### F14 · P1 · Sync pagination tugallanmasdan cursor oldinga suriladi

Backend default 1000 yozuv va hasMore qaytaradi. Desktop va Mobile bir javobdan keyin serverTime ni lastSyncAt qilib saqlaydi, qolgan sahifalarni olmaydi. 1001 yoki ko‘proq tarixiy yozuvda qolgan qism incremental syncdan tushib qoladi. Ayrim dashboard full-readlari bugungi ma’lumotni tiklashi mumkin, tarix uchun kafolat yo‘q. Tuzatish: barcha sahifalarni stabil cursor bilan olib bo‘lgach checkpoint.

Dalil: [comp-bar-server/backend/src/modules/sync/sync.service.ts:299](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:299), [desktop/src/store/syncEngine.ts:175](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:175), [desktop/src/store/syncEngine.ts:208](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:208), [media-project-mobile/src/store/index.ts:1322](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:1322).

### F15 · P1 · Sync serverTime o‘qilgan ma’lumotning haqiqiy chegarasi emas

Products/inventory/snapshots so‘rovlari tugaganidan keyin new Date() checkpoint yaratiladi. Masalan query T1da tugadi, boshqa yozuv T2da commit bo‘ldi, serverTime T3da olindi: T2 yozuvi bu javobga kirmaydi, keyingi updatedSince(T3) ham uni olmaydi. Tuzatish: querydan oldingi high-water mark va shu chegaragacha o‘qish, deterministik cursor/tiebreaker.

Dalil: [comp-bar-server/backend/src/modules/sync/sync.service.ts:303](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:303), [comp-bar-server/backend/src/modules/sync/sync.service.ts:338](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:338).

### F16 · P1 · O‘chirilgan mahsulot Mobile sync orqali qayta yaratiladi

Backend hard-delete qiladi, syncda deletion tombstone yo‘q. Mobile saveProducts server ro‘yxatini eski lokal ro‘yxatga merge qiladi; yo‘qolgan mahsulotni o‘chirmaydi. syncNow barcha lokal mahsulotlarni yuboradi va backend yo‘q localId ni qayta create qiladi. Tuzatish: deletion tombstone/version, faqat dirty yozuvlarni push qilish va deletionni barcha clientlarga tarqatish.

Dalil: [comp-bar-server/backend/src/modules/products/product.repository.ts:176](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.repository.ts:176), [comp-bar-server/backend/src/modules/products/product.repository.ts:208](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.repository.ts:208), [media-project-mobile/src/db/products.ts:73](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/db/products.ts:73), [media-project-mobile/src/store/index.ts:1300](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:1300).

### F17 · P1 · Mahsulot o‘chirilgach uning savdosi kunlik jamidan yo‘qoladi

Delete inventory tarixini saqlaydi, ammo snapshot qayta hisoblanganda faqat mavjud visibleProducts bo‘yicha derivedItems yig‘iladi. Mahsulot bugun sotilib, keyin o‘chirilsa, keyingi recompute uning tushumi/foydasini kundalik jamidan chiqaradi. Tuzatish: hisobni inventory/sale yozuvlaridan qurish; o‘chirilgan mahsulotning tarixiy narx va nomini saqlash.

Dalil: [comp-bar-server/backend/src/modules/products/product.service.ts:570](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.service.ts:570), [comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:100](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:100), [comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:106](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/snapshots/snapshot.service.ts:106).

### F18 · P1 · Desktop offline kirim mavjud inventoryni yangilamaydi

restockProductOffline faqat Product.quantity ni oshirib product queuega qo‘yadi. Backend sync product upsertini bajaradi, lekin REST restockdagi InventoryEntry.startQuantity/currentQuantity tuzatishlarini bajarmaydi. Bugungi inventory yozuvi allaqachon bo‘lsa, mahsulot qoldig‘i va savdo uchun mavjud qoldiq ajraladi. Tuzatish: kirim hodisasini sync protokolida ifodalash va yagona biznes funksiyasi orqali qo‘llash.

Dalil: [desktop/src/screens/ProductsScreen.tsx:564](/Users/dilbek/Desktop/hisvex/desktop/src/screens/ProductsScreen.tsx:564), [desktop/src/screens/ProductsScreen.tsx:588](/Users/dilbek/Desktop/hisvex/desktop/src/screens/ProductsScreen.tsx:588), [comp-bar-server/backend/src/modules/sync/sync.service.ts:152](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:152).

### F19 · P1 · Mobile offline narx o‘zgarishi eski savdo qiymatini qayta baholaydi

getInventoryWithProduct va offline range join tarixiy entry narxlari o‘rniga joriy Product.buyPrice/sellPrice ni ustun qo‘yadi. updateProduct ham oldingi sotuvlarni lockedRevenue/lockedProfitga ajratmasdan bugungi narxni almashtiradi. Natija: narx tahriri avvalgi savdo tushumi/foydasini o‘zgartirishi va sync bilan serverga ko‘chishi mumkin. Tuzatish: entry narxlarini ustun qo‘yish, REST bilan bir xil realized-sale lock semantikasi.

Dalil: [media-project-mobile/src/db/inventory.ts:49](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/db/inventory.ts:49), [media-project-mobile/src/api/client.ts:698](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:698), [media-project-mobile/src/api/client.ts:838](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:838).

### F20 · P1 · Mobile mahsulot yaratishda kg birligini yubormaydi

createProduct POST tanasida unit yo‘q. Backend unit berilmaganda dona deb normalizatsiya qiladi; fractional quantity ham dona qoidasi bilan yaxlitlanadi. Masalan 2.5 kg mahsulot noto‘g‘ri birlik/qoldiq bilan yaratilishi mumkin. Tuzatish: create/update/sync kontraktini bir xil typed DTOga keltirish va unitni yuborish.

Dalil: [media-project-mobile/src/api/client.ts:642](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:642), [comp-bar-server/backend/src/modules/products/product.validation.ts:31](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.validation.ts:31), [comp-bar-server/backend/src/modules/products/product.service.ts:80](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/products/product.service.ts:80).

### F21 · P1 · Mobile sync ACK yangi tahrirni o‘chiradi

Navbat bir item.id bo‘yicha yangilanadi. Request ketayotgan paytda shu mahsulot yana tahrirlansa, yangi versiya navbatga yoziladi. Eski request ACKi clearSyncQueue([id]) orqali yangi versiyani ham o‘chiradi. Eski request xatosi ham retriedItems orqali yangi versiyani eski payload bilan almashtirishi mumkin. Tuzatish: id+version yoki immutable operation ID bo‘yicha ACK/retry.

Dalil: [media-project-mobile/src/db/syncQueue.ts:8](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/db/syncQueue.ts:8), [media-project-mobile/src/db/syncQueue.ts:27](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/db/syncQueue.ts:27), [media-project-mobile/src/api/client.ts:1331](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:1331).

### F22 · P1 · Kecha offline qilingan savdo kun almashgach serverga qabul qilinmaydi

Sync oldingi business-day inventory/snapshotlarini PAST_DAY_LOCKED bilan rad qiladi. Desktop ushbu sababni terminal deb hisoblab yuborilgan yozuvni navbatdan o‘chiradi. Kechasi uzilgan internet ertalab tiklansa, haqiqiy sotuv server tarixiga tushmay qoladi. Tuzatish: tasdiqlangan offline hodisaning sodir bo‘lgan vaqtini saqlash va yopilgan kunni audit bilan reconciliation qilish; rad etilgan yozuvni yo‘qotmaslik.

Dalil: [comp-bar-server/backend/src/modules/sync/sync.service.ts:73](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:73), [desktop/src/store/syncEngine.ts:93](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:93), [desktop/src/store/syncEngine.ts:130](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:130).

### F23 · P1 · Logout yoki sessiya almashtirilishi unsynced savdolarni o‘chiradi

Desktop clearSession offline queue ni tozalaydi. Mobile logout local products/inventory/snapshots va queue ni o‘chiradi. Shu handlerlar majburiy SESSION_REPLACED holatida ham ishlaydi. Hisoblar aralashmasligini ta’minlash uchun foydalanuvchi bo‘yicha saqlash kerak; hozir autentifikatsiya hayot sikli tasdiqlanmagan moliyaviy yozuvlarni yo‘qotadi.

Dalil: [desktop/src/store/authStore.ts:124](/Users/dilbek/Desktop/hisvex/desktop/src/store/authStore.ts:124), [desktop/src/store/authStore.ts:144](/Users/dilbek/Desktop/hisvex/desktop/src/store/authStore.ts:144), [media-project-mobile/src/store/index.ts:331](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:331).

### F24 · P1 · Vaqtinchalik backend xatosi Mobile ma’lumotlarini o‘chirishgacha boradi

Backend authenticate ichidagi DB exception ham 401 Invalid token ga aylantiriladi. Mobile refresh har qanday HTTP response errorni invalid deb oladi; bootstrap /auth/me ning haqiqiy offline deb tanilmagan xatosida local data va queue ni tozalaydi. 500/429 yoki DB outage noto‘g‘ri logout va offline savdo yo‘qolishiga olib kelishi mumkin. Tuzatish: faqat isbotlangan session rejectionda logout; transient xatolarda ma’lumotni saqlash.

Dalil: [comp-bar-server/backend/src/modules/auth/auth.middleware.ts:113](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/auth/auth.middleware.ts:113), [media-project-mobile/src/api/client.ts:466](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:466), [media-project-mobile/app/_layout.tsx:186](/Users/dilbek/Desktop/hisvex/media-project-mobile/app/_layout.tsx:186).

### F25 · P1 · Web offline navbat hisob egasiga bog‘lanmagan

IndexedDB queue yozuvida owner/user/session yo‘q. Logout navbatni saqlab qoladi; keyingi flush hozirgi apiToken bilan yuboradi. A hisobidagi payload B hisobining sessiyasida replay qilinadi. Odatda begona productId 404 berib navbatni to‘xtatadi; mos localId bo‘lsa noto‘g‘ri hisob ma’lumoti o‘zgarishi mumkin. Tuzatish: owner bo‘yicha queue va kalit, yuborishda owner mosligini majburiy tekshirish.

Dalil: [hisvex-web/src/lib/offlineQueue.ts:26](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/offlineQueue.ts:26), [hisvex-web/src/lib/authStore.ts:103](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/authStore.ts:103), [hisvex-web/src/lib/api.ts:282](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:282), [hisvex-web/src/lib/api.ts:543](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:543).

### F26 · P1 · Mobile hisob almashtirishda oldingi hisob keshi qoladi

logout products/currentInventory ni reset qiladi, lekin inventoryPerDateCache, inventoryRangeCache va load-time holatini tozalamaydi. loadInventoryByDate 30 soniyalik cache hitda cached.items ni currentInventoryga qaytaradi. Bir qurilmada A → B tez almashganda A ma’lumoti Bga ko‘rinishi mumkin. Tuzatish: barcha store/cache/inflight natijalarini user ID bilan ajratish va account generation tekshiruvi.

Dalil: [media-project-mobile/src/store/index.ts:359](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:359), [media-project-mobile/src/store/index.ts:663](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:663).

### F27 · P2 · Sync checkpoint Desktop va Mobileda userga bog‘lanmagan

Desktop LAST_SYNC_KEY bitta global localStorage kaliti. Mobile LAST_SYNC umumiy app meta ichida; logout queue ni o‘chiradi, meta/cursorni reset qilmaydi. B hisobiga kirganda Aning yaqindagi cursori Bning eski ma’lumotlarini pull qilishni cheklaydi. Tuzatish: checkpointni owner hamda sync schema versiyasi bilan saqlash.

Dalil: [desktop/src/store/syncEngine.ts:15](/Users/dilbek/Desktop/hisvex/desktop/src/store/syncEngine.ts:15), [media-project-mobile/src/db/syncQueue.ts:42](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/db/syncQueue.ts:42), [media-project-mobile/src/store/index.ts:1324](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:1324), [media-project-mobile/src/store/index.ts:331](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/store/index.ts:331).

### F28 · P1 · Web offline shifrlash kaliti parallel birinchi yozuvlarda yo‘qoladi

getOrCreateKey da shared initialization promise/lock yo‘q. Ikki birinchi chaqiruv alohida AES kalit yaratadi; oxirgisi localStoragega yozilib, ikkinchi ciphertextni o‘qib bo‘lmay qoladi. Haqiqiy funksiya in-memory storage bilan tekshirildi: 2 xil kalit, saqlangan kalitga faqat 1 tasi mos. getQueuedWrites Promise.all ishlatgani sabab bitta buzilgan yozuv butun flushni to‘xtatadi. Storage set ishlamasa har chaqiruvda ham yangi kalit chiqadi.

Dalil: [hisvex-web/src/lib/offlineQueue.ts:50](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/offlineQueue.ts:50), [hisvex-web/src/lib/offlineQueue.ts:159](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/offlineQueue.ts:159).

### F29 · P2 · Web navbatdagi bitta doimiy xato keyingi barcha yozuvlarni bloklaydi

Flush birinchi 404/409/422 da break qiladi; terminal xatolarni ajratish yoki reconciliation/dead-letter yo‘li yo‘q. Kechagi PAST_DAY_LOCKED yoki o‘chirilgan product yozuvi boshga tushsa, bugungi to‘g‘ri savdolar ham ketmaydi. Tuzatish: dependencylarni hisobga olgan holda xatoni operatorga chiqarish va zararsiz izolyatsiya; yozuvni shunchaki o‘chirish emas.

Dalil: [hisvex-web/src/lib/offlineQueue.ts:198](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/offlineQueue.ts:198), [comp-bar-server/backend/src/modules/sync/sync.service.ts:73](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:73).

### F30 · P1 — indeks DBda mavjud bo‘lsa · Payment receiptHash sparse unique indeksi null default bilan to‘qnashadi

receiptHash default:null, indeksi esa unique+sparse. Sparse mavjud bo‘lmagan maydonni tashlaydi, aniq null maydonni emas. Mongoose modelining yangi payment obyektida receiptHash haqiqatan mavjud va null ekanligi tasdiqlandi. Ikki null hashli payment faol indeks bilan E11000 beradi; eski duplicate null yozuvlar indeks qurilishini buzishi mumkin. Production indeks ro‘yxati tekshirilmadi. Tuzatish: string-hashlarga partial unique index yoki maydonni butunlay omit qilish.

Dalil: [comp-bar-server/backend/src/modules/payments/payment.model.ts:82](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.model.ts:82), [comp-bar-server/backend/src/modules/payments/payment.model.ts:138](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.model.ts:138).

### F31 · P1 · OCR summa mosligini bank to‘lovi tasdig‘i o‘rnida ishlatadi

Rasmdan kutilgan summa topilsa payment provisioned bo‘ladi va obuna darhol aktivlashadi. Bank transferi, to‘g‘ri qabul qiluvchi va tranzaksiya yagona ekanligi tekshirilmaydi. Rasmni o‘zgartirish raw-bytes hashini o‘zgartiradi, demak bir transferni qayta ishlatishga qarshi yetarli dalil emas. 48 soatlik vaqtincha grant shu yo‘l bilan haqiqiy to‘lovsiz olinishi mumkin. Tuzatish: OCRni tekshiruvchi yordamchi sifatida saqlash, entitlementni bank/admin tasdig‘iga bog‘lash yoki qat’iy nazoratli trial siyosati.

Dalil: [comp-bar-server/backend/src/modules/payments/payment.service.ts:97](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:97), [comp-bar-server/backend/src/modules/payments/payment.service.ts:128](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:128), [comp-bar-server/backend/src/modules/payments/payment.service.ts:142](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:142).

### F32 · P1 · Provisional chek rad etilsa oldingi pullik obuna ham bekor bo‘ladi

rejectPayment va auto-expire deactivateFromPayment(userId) ni chaqiradi. U aynan shu payment bergan vaqtni qaytarmasdan foydalanuvchining barcha active subscriptionlarini o‘chiradi va isPayed=false qiladi. Masalan avval 12 oy to‘lagan foydalanuvchi yangi noto‘g‘ri chek yuborsa, eski haqqi ham yo‘qoladi. Tuzatish: entitlement grantlarini payment bo‘yicha alohida ledgerda saqlash va faqat tegishli grantni revoke qilish.

Dalil: [comp-bar-server/backend/src/modules/payments/payment.service.ts:291](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:291), [comp-bar-server/backend/src/modules/payments/payment.service.ts:527](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:527), [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:171](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:171).

### F33 · P1 · Payment completed va obuna aktivlashishi atomik emas

Avval payment completedga o‘tadi, keyin subscription aktivlashadi. Shu orada process o‘lsa, retry completedni ko‘rib qaytadi, foydalanuvchi esa obunasiz qoladi. Aktivlashish qisman bajarilib keyingi yozuv xato bersa, payment pendingga qaytarilishi keyingi urinishda muddatni yana uzaytirishi mumkin. Rad etishdagi revoke ham xato qilsa status qayta ishlashga mos emas. Tuzatish: tranzaksiya yoki durable outbox/saga va payment ID bo‘yicha idempotent grant.

Dalil: [comp-bar-server/backend/src/modules/payments/payment.service.ts:218](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:218), [comp-bar-server/backend/src/modules/payments/payment.service.ts:355](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:355), [comp-bar-server/backend/src/modules/payments/payment.service.ts:373](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:373), [comp-bar-server/backend/src/modules/payments/payment.service.ts:526](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:526).

### F34 · P1 · Parallel obuna uzaytirish to‘langan muddatni yo‘qotadi

activateOrExtend endDate ni o‘qib yangi sanani hisoblaydi; update filterida oldingi endDate/version yo‘q. Ikki alohida 1 oylik to‘lov bir vaqtda kelganda ikkalasi bir sanadan +1 hisoblab yozadi: +2 o‘rniga +1 qoladi. Active-subscription unique indeksi bu read-modify-write poygasini bartaraf etmaydi. Tuzatish: optimistic version retry yoki atomik/tranzaksion grant ledger.

Dalil: [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:90](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:90), [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:95](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:95).

### F35 · P2 · Obuna uzaytirilgach keyingi eslatmalar kelmaydi

Renewal mavjud subscription endDate ni yangilaydi, reminderSentAt ni null qilmaydi. findExpiringSoon esa faqat reminderSentAt:null yozuvlarni oladi. Bir marta eslatma yuborilgan obuna uzaytirilsa, keyingi davr uchun eslatmadan tushib qoladi. Tuzatish: reminder checkpointni renewal davriga bog‘lash.

Dalil: [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:97](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:97), [comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:279](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/subscriptions/subscription.service.ts:279).

### F36 · P2 · Tasdiq kutayotgan provisioned to‘lovlar admin pending ro‘yxatida yo‘q

getPending faqat status=pending oladi. OCR orqali vaqtincha aktivlangan provisioned payment ham admin tasdig‘ini kutadi, lekin bu ro‘yxatdan tushib qoladi. Telegramdagi dastlabki xabar yetib bormasa, odatiy pending-list orqali topish qiyinlashadi va 48h avtomatik rejectionga borishi mumkin. Tuzatish: review talab qiluvchi barcha statuslarni ro‘yxatga kiritish.

Dalil: [comp-bar-server/backend/src/modules/payments/payment.service.ts:312](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/payments/payment.service.ts:312), [hisvex-bot/src/bot/handlers/admin.ts:1](/Users/dilbek/Desktop/hisvex/hisvex-bot/src/bot/handlers/admin.ts:1).

### F37 · P1 · Render konfiguratsiyasidagi false qiymati true bo‘lib server startini to‘xtatadi

z.coerce.boolean JavaScript Boolean konversiyasini ishlatadi: "false" → true. Haqiqiy o‘rnatilgan Zod bilan tasdiqlandi. render.yaml ALLOW_PUBLIC_REGISTER="false" beradi, production guard esa true deb process.exit(1) qiladi. MIGRATION_ENABLED="false" ham true bo‘ladi. Tuzatish: env booleanlarini faqat aniq true/false satrlaridan parse qilish.

Dalil: [comp-bar-server/backend/src/config/env.ts:27](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/config/env.ts:27), [comp-bar-server/backend/src/config/env.ts:115](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/config/env.ts:115), [comp-bar-server/render.yaml:91](/Users/dilbek/Desktop/hisvex/comp-bar-server/render.yaml:91).

### F38 · P2 · To‘rtta Axios clientda default timeout amalda o‘rnatilmaydi

Interceptor config.timeout === undefined ni tekshiradi. Axios merged default timeout=0 beradi, shuning uchun 10/60 soniyalik qiymat qo‘yilmaydi. O‘rnatilgan Axios bilan custom adapter orqali tasdiqlandi: timeout=0. Alohida explicit timeout berilgan requestlar bundan mustasno; Web server proxy timeouti browser Axios timeoutidan alohida. Tuzatish: axios.create da default timeout va heavy request uchun aniq override.

Dalil: [hisvex-web/src/lib/api.ts:150](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:150), [desktop/src/api/client.ts:155](/Users/dilbek/Desktop/hisvex/desktop/src/api/client.ts:155), [media-project-mobile/src/api/client.ts:412](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/api/client.ts:412), [hisvex-bot/src/services/api-client.ts:76](/Users/dilbek/Desktop/hisvex/hisvex-bot/src/services/api-client.ts:76).

### F39 · P2 · Web rasm uploadi multipart o‘rniga JSON yuboradi

Axios instance Content-Type: application/json bilan yaratilgan, uploadImage esa FormData uchun override bermaydi. Haqiqiy Axios transformi custom adapterda {"image":{}} JSON chiqardi. Backend multer fayl topa olmaydi. Tuzatish: FormData request uchun JSON headerini olib tashlash/to‘g‘ri multipart konfiguratsiyasi.

Dalil: [hisvex-web/src/lib/api.ts:436](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:436), [hisvex-web/src/lib/api.ts:1](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:1).

### F40 · P1 · Desktop CSP Render failover va R2 rasmlarini bloklaydi

index.html connect-src faqat self va Railwayni qabul qiladi; API_BACKUP_URL esa onrender.com. img-src ham faqat Railway/data/self: R2 boshqa hostda bo‘lsa rasm ochilmaydi. Bu tarmoqdan oldingi browser cheklovi. Tuzatish: kerakli aniq backup va asset originlarini deploy konfiguratsiyasidan CSPga kiritish.

Dalil: [desktop/index.html:6](/Users/dilbek/Desktop/hisvex/desktop/index.html:6), [desktop/src/constants/index.ts:1](/Users/dilbek/Desktop/hisvex/desktop/src/constants/index.ts:1).

### F41 · P2 · Web proxy 204/205/304 javoblarini TypeErrorga aylantiradi

Upstream javobi har doim arrayBufferga o‘qilib NextResponse(body,{status}) qilinadi. Body taqiqlangan statuslarda bo‘sh ArrayBuffer ham body hisoblanadi. Runtime konstruktor tekshiruvida 204/205/304 TypeError berdi. Masalan backend CORS OPTIONS 204 yoki conditional image GET 304. Tuzatish: ushbu statuslar uchun null body; HEAD javobini ham alohida hisobga olish.

Dalil: [hisvex-web/src/app/api/[...path]/route.ts:164](/Users/dilbek/Desktop/hisvex/hisvex-web/src/app/api/[...path]/route.ts:164).

### F42 · P2 · Web/Desktop kesh TTLsi keshdan o‘qilganda yana yangilanadi

Cache hit custom Axios adapter bilan 200 javob qaytaradi; success interceptor uni yangi server javobidek cache.set(... Date.now()) qiladi. TTLdan qisqa oraliqda o‘qilsa eski ma’lumot cheksiz yangidek ko‘rinishi mumkin. Tuzatish: cached response belgisi va faqat real network javobida fetchedAt yangilanishi.

Dalil: [hisvex-web/src/lib/api.ts:173](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:173), [hisvex-web/src/lib/api.ts:270](/Users/dilbek/Desktop/hisvex/hisvex-web/src/lib/api.ts:270), [desktop/src/api/client.ts:161](/Users/dilbek/Desktop/hisvex/desktop/src/api/client.ts:161), [desktop/src/api/client.ts:212](/Users/dilbek/Desktop/hisvex/desktop/src/api/client.ts:212).

### F43 · P2 · Audit log biznes tranzaksiyasining rollbackini kuzatmaydi

auditService.log session olmaydi va AuditEventModel.create ni mustaqil bajaradi. U inventory/sync transaction ichida chaqiriladi. Keyingi xatoda transaction rollback bo‘lsa ham audit yozuvi qoladi; Mongo callback retry qilsa takror log paydo bo‘ladi. Tuzatish: bir xil session yoki commitdan keyingi ishonchli outbox.

Dalil: [comp-bar-server/backend/src/modules/audit/audit.service.ts:15](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/audit/audit.service.ts:15), [comp-bar-server/backend/src/modules/inventory/inventory.service.ts:771](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/inventory/inventory.service.ts:771), [comp-bar-server/backend/src/modules/sync/sync.service.ts:247](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/src/modules/sync/sync.service.ts:247).

### F44 · P2 · CSV eksportda spreadsheet formula injection

Desktop va Mobile CSV escaping faqat qo‘shtirnoq/delimiterlarni ishlaydi. Product.name =1+1 kabi qiymat bilan boshlansa spreadsheet uni matn emas formula sifatida ochishi mumkin; qo‘shtirnoq bilan o‘rash formula talqinini to‘xtatmaydi. Real ta’sir Excel/LibreOffice siyosati va foydalanuvchining faylni ochishiga bog‘liq. Tuzatish: xavfli prefikslarni matnlashtirish yoki typed-string XLSX kataklar.

Dalil: [desktop/src/screens/StatisticsScreen.tsx:715](/Users/dilbek/Desktop/hisvex/desktop/src/screens/StatisticsScreen.tsx:715), [desktop/src/screens/StatisticsScreen.tsx:755](/Users/dilbek/Desktop/hisvex/desktop/src/screens/StatisticsScreen.tsx:755), [media-project-mobile/src/utils/statisticsExport.ts:52](/Users/dilbek/Desktop/hisvex/media-project-mobile/src/utils/statisticsExport.ts:52).

## Qo‘shimcha tekshirish talab qiladigan nuqtalar

Bu bandlar yuqoridagi kod topilmalaridan alohida: haqiqiy deploy/provayder/browser xatti-harakati tekshirilmagan.

1. **Production CORS va packaged Desktop/Landing.** Backend default production originlari faqat hisvex-web va localhost. Electron build `loadFile`, `webSecurity:true` ishlatadi; file originning ruxsat olishi aniq buildda tekshirilishi kerak. Landing Render APIga to‘g‘ridan-to‘g‘ri fetch qiladi; uning domeni CLIENT_URLga qo‘shilmasa yangi versiya o‘qilmay fallback qoladi. Dalil: [app.ts:50](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srcapp.ts:50), [main.ts:46](/Users/dilbek/Desktop/hisvex/desktop/electron/main.ts:46), [Landing App.tsx:63](/Users/dilbek/Desktop/hisvex/hisvex-landing/src/App.tsx:63).

2. **Click callback body formati.** Appda express.json bor, express.urlencoded yo‘q. Form-urlencoded kelgan callback req.bodyga kerakli fieldlarni bermaydi; signature tekshiruvi rad etadi. Ulangan Click merchantning haqiqiy Content-Type/sample callbackini tekshirish zarur; provayderning joriy hujjatini ushbu auditda olish imkoni bo‘lmadi. Dalil: [app.ts:90](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srcapp.ts:90), [click.routes.ts:12](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srcmodules/payments/click.routes.ts:12), [payment.controller.ts:143](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srcmodules/payments/payment.controller.ts:143).

3. **Electron navigation va IPC chegarasi.** contextIsolation/nodeIntegration/sandbox yaxshi o‘rnatilgan. Ammo navigation/window-open allow-list va IPC sender validation ko‘rinmadi; preload token/refresh/PIN operatsiyalarini ochadi. Ishonchsiz sahifaga shu oynada navigatsiya bo‘lsa xavf tug‘iladi; bunday navigatsiyani amalda keltirib chiqaruvchi exploit tasdiqlanmadi. Dalil: [main.ts:36](/Users/dilbek/Desktop/hisvex/desktop/electron/main.ts:36), [preload.ts:1](/Users/dilbek/Desktop/hisvex/desktop/electron/preload.ts:1), [ipc.ts:70](/Users/dilbek/Desktop/hisvex/desktop/electron/ipc.ts:70).

4. **Chek rasmlarining ommaviy URLlari.** Receiptlar ham productlar bilan bitta public URL mexanizmi va public, immutable cache orqali beriladi. URL qo‘lga kirsa backend auth qatlamisiz ochish dizayni mavjud; R2 bucketning amaldagi public-access siyosati tekshirilmadi. Moliyaviy chek uchun private object va qisqa muddatli signed URL maqsadga muvofiq. Dalil: [payment.service.ts:100](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srcmodules/payments/payment.service.ts:100), [r2.ts:31](/Users/dilbek/Desktop/hisvex/comp-bar-server/backend/srclib/r2.ts:31).

## Tuzatish navbati

1. Credential faoliyatini aniqlash; Telegram link va OTP bypass; R2 ownership; entitlement/PIN/session chegaralari.
2. Sale operation ID va atomik dedup; failover replay siyosati; commitdan keyingi xato; offline hodisalarning yo‘qolmasligi.
3. LWW/quantity mirror; tombstone; sync pagination/cursor; accountga bog‘langan queue/cache va ACK versiyasi.
4. Payment indeksi, provisional grant/revoke va atomik payment entitlement ledgeri.
5. Env parsing, Desktop CSP, Web upload/proxy, client timeout va qolgan P2lar.

Tuzatishlar ushbu auditda bajarilmadi. Production DB indekslari, R2 ruxsatlari, haqiqiy Click callbacks, chiqarilgan Electron/Android buildlari, restore jarayoni va dependency advisories alohida verification talab qiladi.
