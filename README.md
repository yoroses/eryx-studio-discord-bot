# Eryx Studio Discord Bot

Discord bot sederhana yang bisa ngobrol seperti ChatGPT memakai Claude API (Anthropic), slash command Discord, dan mention langsung.

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
- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL` opsional, default `claude-opus-4-8`
- `CLAUDE_MAX_TOKENS` opsional, default `1024`
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
sudo apt install -y git curl
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

5. Buat file environment:

```bash
cp .env.example .env
nano .env
```

6. Isi `.env` minimal dengan:

```env
DISCORD_TOKEN=token_bot_discord
DISCORD_CLIENT_ID=application_client_id
DISCORD_GUILD_ID=id_server_testing
ANTHROPIC_API_KEY=api_key_claude
CLAUDE_MODEL=claude-opus-4-8
CLAUDE_MAX_TOKENS=1024
REPLY_DELAY_MS=1500
SELF_CHECK_ENABLED=true
STRICT_FACTUAL_MODE=true
ASK_CLARIFY_FIRST_MODE=true
ROLE_AWARE_MENTION_MODE=true
```

7. Register slash command:

```bash
npm run register
```

8. Jalankan bot:

```bash
npm start
```

9. Kalau mau bot tetap hidup setelah logout SSH, paling gampang pakai `pm2`:

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

## Cara ambil API key Claude

1. Buka `https://console.anthropic.com/settings/keys`.
2. Login atau buat akun Anthropic.
3. Klik `Create Key`, buat API key baru.
4. Salin ke `ANTHROPIC_API_KEY` di file `.env`.

## Catatan

- Bot ini menyimpan konteks chat di memori proses. Kalau bot restart, riwayat percakapan akan hilang.
- Project ini mengirim ulang history chat ke API di setiap request agar konteks percakapan tetap nyambung.
- Untuk project production, lebih bagus kalau riwayat disimpan ke database seperti SQLite, Postgres, atau Redis.
- Kalau `DISCORD_GUILD_ID` diisi, command akan didaftarkan khusus ke server itu. Kalau kosong, command didaftarkan global.
- Bot tidak perlu permission `Administrator` untuk mention member. Yang penting intent member aktif dan permission dasar chat tersedia.
- Untuk fitur voice, bot juga butuh izin `Connect` dan `Speak` di voice channel tujuan.
- Playback YouTube paling stabil dijalankan di VPS Linux dengan jaringan yang stabil.
- Project ini pakai `@anthropic-ai/sdk` resmi dan memanggil `messages.create(...)` dengan model default `claude-opus-4-8`.
- Kalau mau model yang lebih hemat biaya, isi `CLAUDE_MODEL` dengan `claude-sonnet-5` atau `claude-haiku-4-5`.
