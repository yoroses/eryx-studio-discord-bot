# Eryx Studio Discord Bot

Discord bot sederhana yang bisa ngobrol seperti ChatGPT memakai Gemini API, slash command Discord, dan mention langsung.

## Fitur

- `/chat` untuk ngobrol dengan AI
- `/reset` untuk menghapus konteks percakapan di channel saat ini
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
- `GEMINI_API_KEY`
- `GEMINI_MODEL` opsional, default `gemini-2.0-flash-lite`
- `SYSTEM_PROMPT` opsional

4. Register slash command:

```bash
npm run register
```

5. Jalankan bot:

```bash
npm start
```

## Cara pakai mention

Kamu bisa mention bot langsung tanpa slash command:

```text
@Eryx Studio jelaskan produk saya dengan bahasa santai
```

## Cara bikin Discord bot

1. Buka Discord Developer Portal.
2. Buat `New Application`.
3. Masuk ke menu `Bot`, lalu buat bot.
4. Aktifkan bot token dan salin ke `DISCORD_TOKEN`.
5. Salin `Application ID` ke `DISCORD_CLIENT_ID`.
6. Di menu `OAuth2 > URL Generator`, pilih scope `bot` dan `applications.commands`.
7. Beri permission minimal `Send Messages`, `View Channels`, dan `Use Slash Commands`.
8. Pakai URL hasil generator untuk invite bot ke server kamu.
9. Di menu `Bot`, aktifkan `Message Content Intent` agar bot bisa membaca isi pesan mention.

## Cara ambil API key Gemini

1. Buka `https://aistudio.google.com/`.
2. Login dengan akun Google.
3. Buat API key Gemini dari AI Studio.
4. Salin ke `GEMINI_API_KEY` di file `.env`.

## Catatan

- Bot ini menyimpan konteks chat di memori proses. Kalau bot restart, riwayat percakapan akan hilang.
- Project ini mengirim ulang history chat ke API di setiap request agar konteks percakapan tetap nyambung.
- Untuk project production, lebih bagus kalau riwayat disimpan ke database seperti SQLite, Postgres, atau Redis.
- Kalau `DISCORD_GUILD_ID` diisi, command akan didaftarkan khusus ke server itu. Kalau kosong, command didaftarkan global.
- Project ini memakai `openai` SDK dengan endpoint kompatibel OpenAI milik Gemini di `https://generativelanguage.googleapis.com/v1beta/openai/`.
- Default model diset ke `gemini-2.0-flash-lite`, yang cocok untuk usage ringan dan free tier Gemini.
- Untuk transisi yang lebih aman, config masih menerima `GROQ_API_KEY` sebagai fallback sementara kalau nama variabel API key di `.env` lama belum diganti.
