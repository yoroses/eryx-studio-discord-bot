# Eryx Studio Discord Bot

Discord bot sederhana yang bisa ngobrol seperti ChatGPT memakai Groq API, slash command Discord, dan mention langsung.

## Fitur

- `/chat` untuk ngobrol dengan AI
- `/reset` untuk menghapus konteks percakapan di channel saat ini
- `/join` untuk masuk ke voice channel kamu
- `/leave` untuk keluar dari voice channel
- `/stop` untuk menghentikan audio
- `/play` untuk memutar audio dari URL
- Mention bot langsung, misalnya `@Eryx Studio tolong bikin caption promo`
- Konteks percakapan disimpan per user per channel

## Cara pakai

1. Install dependency:

```bash
npm install
```

2. Copy file environment:

```bash
copy .env.example .env
```

3. Isi `.env` dengan:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` opsional tapi direkomendasikan saat testing agar slash command muncul lebih cepat
- `GROQ_API_KEY`
- `GROQ_MODEL` opsional, default `openai/gpt-oss-20b`
- `SYSTEM_PROMPT` opsional

4. Register slash command:

```bash
npm run register
```

5. Jalankan bot:

```bash
npm start
```

## Install di VPS

Contoh di bawah ini cocok untuk VPS Ubuntu atau Debian.

1. Install dependency sistem:

```bash
sudo apt update
sudo apt install -y git curl ffmpeg python3 python3-pip
```

2. Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

3. Clone repo:

```bash
git clone https://github.com/yoroses/eryx-studio-discord-bot.git
cd eryx-studio-discord-bot
```

4. Install dependency project:

```bash
npm install
```

5. Pastikan `yt-dlp` terpasang untuk fitur voice YouTube:

```bash
python3 -m pip install -U yt-dlp
```

6. Buat file environment:

```bash
cp .env.example .env
nano .env
```

7. Isi `.env` minimal dengan:

```env
DISCORD_TOKEN=token_bot_discord
DISCORD_CLIENT_ID=application_client_id
DISCORD_GUILD_ID=id_server_testing
GROQ_API_KEY=api_key_groq
GROQ_MODEL=openai/gpt-oss-20b
REPLY_DELAY_MS=1500
SELF_CHECK_ENABLED=true
STRICT_FACTUAL_MODE=true
ASK_CLARIFY_FIRST_MODE=true
ROLE_AWARE_MENTION_MODE=true
```

8. Register slash command:

```bash
npm run register
```

9. Jalankan bot:

```bash
npm start
```

10. Kalau mau bot tetap hidup setelah logout SSH, paling gampang pakai `pm2`:

```bash
sudo npm install -g pm2
pm2 start src/index.js --name eryx-bot
pm2 save
pm2 startup
```

## Cara pakai mention

Kamu bisa mention bot langsung tanpa slash command:

```text
@Eryx Studio jelaskan produk saya dengan bahasa santai
```

Untuk voice, kamu juga bisa pakai mention:

```text
@Eryx Studio masuk voice
@Eryx Studio play https://www.youtube.com/watch?v=dQw4w9WgXcQ
@Eryx Studio stop
@Eryx Studio leave voice
```

Untuk slash command voice:

```text
/join
/play url:https://www.youtube.com/watch?v=dQw4w9WgXcQ
/stop
/leave
```

## Cara bikin Discord bot

1. Buka Discord Developer Portal.
2. Buat `New Application`.
3. Masuk ke menu `Bot`, lalu buat bot.
4. Aktifkan bot token dan salin ke `DISCORD_TOKEN`.
5. Salin `Application ID` ke `DISCORD_CLIENT_ID`.
6. Di menu `OAuth2 > URL Generator`, pilih scope `bot` dan `applications.commands`.
7. Beri permission minimal `View Channels`, `Read Message History`, `Send Messages`, `Use Slash Commands`, `Connect`, dan `Speak`.
8. Pakai URL hasil generator untuk invite bot ke server kamu.
9. Di menu `Bot`, aktifkan `Message Content Intent` agar bot bisa membaca isi pesan mention.
10. Di menu `Bot`, aktifkan `Server Members Intent` agar bot bisa membaca daftar member, display name, role, dan melakukan pencocokan mention member dengan lebih akurat.

## Cara ambil API key Groq

1. Buka `https://console.groq.com/keys`.
2. Login atau buat akun Groq.
3. Buat API key baru.
4. Salin ke `GROQ_API_KEY` di file `.env`.

## Catatan

- Bot ini menyimpan konteks chat di memori proses. Kalau bot restart, riwayat percakapan akan hilang.
- Project ini mengirim ulang history chat ke API di setiap request agar konteks percakapan tetap nyambung.
- Untuk project production, lebih bagus kalau riwayat disimpan ke database seperti SQLite, Postgres, atau Redis.
- Kalau `DISCORD_GUILD_ID` diisi, command akan didaftarkan khusus ke server itu. Kalau kosong, command didaftarkan global.
- Bot tidak perlu permission `Administrator` untuk mention member. Yang penting intent member aktif dan permission dasar chat tersedia.
- Untuk fitur voice, bot juga butuh izin `Connect` dan `Speak` di voice channel tujuan.
- Untuk fitur voice YouTube, server sebaiknya punya `ffmpeg`, `python3`, dan `yt-dlp`.
- Playback YouTube paling stabil dijalankan di VPS Linux dengan jaringan yang stabil.
- Berdasarkan docs resmi Groq saat ini, Groq kompatibel dengan OpenAI SDK jika `baseURL` diarahkan ke `https://api.groq.com/openai/v1`.
- Untuk kompatibilitas yang lebih aman, project ini memakai `chat.completions.create(...)` dengan model default `openai/gpt-oss-20b`.
