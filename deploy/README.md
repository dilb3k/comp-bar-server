# Oracle Cloud'ga ko'chirish

Backend va botni Render'dan Oracle Cloud Always Free serveriga ko'chirish.

## Nega

Bot Render'da `starter` tarifida turibdi — oyiga **$7**, chunki Render'ning
bepul tarifi faqat web servislarga tegishli va long-polling qiladigan botni
hech qanday HTTP so'rovi "uyg'otmaydi". Aynan o'sha $7 lik hisob to'lanmay
qolgani uchun butun workspace to'xtatilgan va production API 40 ta servis
bilan birga o'chgan.

Oracle'ning Always Free Ampere A1 shakli: **4 OCPU, 24 GB RAM, 200 GB disk**,
muddatsiz bepul. Render'ning bepul 512 MB'iga nisbatan bu ~48 barobar ko'p
xotira, va oylik to'lov umuman yo'q — ya'ni to'lov o'tmagani uchun servis
o'chishi qayta takrorlanmaydi.

## Nima ko'chadi, nima qoladi

| | Qayerda |
|---|---|
| API (Node) | Oracle → systemd `hisvex-api` |
| Bot (Telegraf) | Oracle → systemd `hisvex-bot` |
| MongoDB | **tegilmaydi** — qayerda bo'lsa o'sha yerda qoladi |
| Web / Landing | Vercel'da qoladi |

Baza MongoDB Atlas'da (`computer-club.mvxpznp.mongodb.net`) va Render'ning
to'xtatilishidan **umuman jabr ko'rmagan** — tekshirildi: 24 foydalanuvchi,
132 mahsulot, 1620 inventar yozuvi, 145 obuna joyida turibdi. Ya'ni Render
faqat kodni ishga tushirib turgan, ma'lumot boshqa joyda. Ko'chirish shuning
uchun ancha oddiy: faqat Node jarayonlarini ko'chiramiz.

Atlas Network Access hozir **hamma IP'ga ochiq** (`0.0.0.0/0`) — bu shu
mashinadan ulanib tasdiqlandi. Ko'chirish uchun qulay (yangi serverning
IP'sini ro'yxatga qo'shish shart emas), lekin xavfsizlik jihatidan bo'sh
joy: ulanish satrini qo'lga kiritgan har kim hamma ijarachining ma'lumotini
o'qiy oladi. Server ishga tushgach, Atlas'da faqat o'sha bitta IP'ga ruxsat
qoldirish kerak.

MongoDB'ni ataylab ko'chirmayapmiz. Buzilgan narsa Render'ning to'lovi edi,
baza emas. Bazani bitta VM'ga ko'chirish uni **boshqariladigan xizmatdan
sizning mas'uliyatingizga** o'tkazadi: zaxira nusxa, yangilanish, xavfsizlik
— hammasi sizniki bo'ladi va bitta disk nosozligi hamma do'konning ma'lumotini
yo'q qiladi. Bir vaqtda ikkita katta o'zgarish qilmaslik kerak.

## Talab qilinadigan narsalar

1. **Oracle Cloud akkaunti** — o'zingiz ochasiz (karta tasdiqlash talab
   qilinadi; Always Free'da pul yechilmaydi).
2. **Domen** — `api.hisvex.uz` kabi. TLS sertifikati domensiz berilmaydi, va
   Android 9+ oddiy HTTP so'rovlarni bloklaydi, ya'ni `http://<IP>` bilan
   mobil ilova ishlamaydi. Domen hali yo'q bo'lsa, vaqtincha bepul
   **DuckDNS** (`hisvex.duckdns.org`) ishlaydi va Let's Encrypt unga
   sertifikat beradi.
3. **Eski Render servisidagi maxfiy qiymatlar** — Render panelidagi
   Environment bo'limidan nusxalaysiz.

## Qadamlar

### 1. Server yarating

Oracle Console → Compute → Instances → Create.

- Image: **Ubuntu 24.04**
- Shape: **VM.Standard.A1.Flex**, 4 OCPU / 24 GB
- SSH kalit: `~/.ssh/id_ed25519.pub` ni qo'shing
- Networking → Security List: 80 va 443 portlarni oching

> Ampere A1 tez-tez "Out of capacity" xatosi beradi. Boshqa Availability
> Domain'ni tanlang yoki bir necha soatdan keyin qayta urinib ko'ring.

### 2. DNS

Domeningizning A yozuvini serverning public IP'siga qarating. Davom etishdan
oldin `dig +short api.hisvex.uz` to'g'ri IP qaytarishini tekshiring — certbot
DNS tarqalmaguncha sertifikat bera olmaydi.

### 3. Serverni sozlang

```bash
ssh ubuntu@<IP>
git clone <backend-repo> /tmp/hisvex-api
sudo bash /tmp/hisvex-api/deploy/bootstrap.sh api.hisvex.uz siz@pochta.uz
```

Skript Node 22, nginx, certbot, fail2ban o'rnatadi, `hisvex` foydalanuvchisini
yaratadi, TLS sertifikat oladi va systemd unitlarini joylashtiradi.

> **Oracle'ning tuzog'i.** Oracle Ubuntu obrazlarida VM ichida iptables
> qoidalari bor va ular Security List'dan **alohida** ishlaydi. Konsolda
> portni ochib, VM ichida ochmaslik — yangi Oracle serveri internetdan o'lik
> ko'rinishining eng keng tarqalgan sababi. `bootstrap.sh` buni hal qiladi.

### 4. Maxfiy qiymatlar

```bash
sudo install -m 640 -o root -g hisvex deploy/api.env.example /etc/hisvex/api.env
sudo install -m 640 -o root -g hisvex deploy/bot.env.example /etc/hisvex/bot.env
sudo nano /etc/hisvex/api.env   # Render panelidan nusxalang
sudo nano /etc/hisvex/bot.env
```

`MONGODB_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` — **aynan** eski
qiymatlar. Boshqa `JWT_SECRET` hamma foydalanuvchini tizimdan chiqarib
yuboradi, boshqa `MONGODB_URL` esa bo'sh baza ko'rsatadi.

### 5. Kodni joylang va ishga tushiring

```bash
sudo -u hisvex git clone <backend-repo> /opt/hisvex/api
sudo -u hisvex git clone <bot-repo>     /opt/hisvex/bot
sudo bash /opt/hisvex/api/deploy/deploy.sh api
sudo bash /opt/hisvex/api/deploy/deploy.sh bot
```

`deploy.sh` build qiladi, servisni qayta ishga tushiradi va **ko'tarilganini
tekshiradi**. Ko'tarilmasa, avvalgi commitni qayta qurib tiklaydi — ya'ni
noto'g'ri push serverni o'lik qoldirmaydi.

### 6. Tekshiring

```bash
bash deploy/smoke.sh https://api.hisvex.uz
```

### 7. Klientlarni yangi manzilga o'tkazing

Buni men qilaman — yangi URL'ni bering. O'zgaradigan joylar:

| Fayl | Ta'sir |
|---|---|
| `hisvex-web/vercel.json` | qayta deploy, foydalanuvchi sezmaydi |
| `media-project-mobile/app.json` + `src/constants/index.ts` | **yangi APK kerak** |
| `desktop/src/constants/index.ts` | **yangi desktop reliz kerak** |
| `/etc/hisvex/bot.env` `BACKEND_URL` | serverda |

Domen ishlatilsa, bu **oxirgi marta** — keyingi ko'chishlarda DNS yozuvi
o'zgaradi, kod emas.

## Kundalik ishlatish

```bash
sudo bash /opt/hisvex/api/deploy/deploy.sh api   # yangilash
journalctl -u hisvex-api -f                      # loglar
systemctl status hisvex-api hisvex-bot           # holat
```

Sertifikat certbot tomonidan avtomatik yangilanadi (systemd timer).
