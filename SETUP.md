# ProLink: setup

Stack (from the system proposal): HTML5/JS front end, Node.js + Express REST API, Prisma ORM with SQLite (PostgreSQL ready), JWT login tokens, bcrypt-hashed passwords.

## 1. Put your two existing files in `public/`

Copy your own `style.css` and `index.html` into the `public/` folder (next to `script.js`).

In `index.html`, replace the last script line

    <script src="script.js" defer></script>

with

    <script src="config.js"></script>
    <script src="script.js" defer></script>
    <script src="bg.js" defer></script>

Nothing else in `index.html` or `style.css` changes.

## 2. Install and create the database (needs Node 18+)

    npm install
    copy .env.example .env      (Mac/Linux: cp .env.example .env)
    npm run setup

Open `.env` and change `JWT_SECRET` to any long random text.

## 3. Run

    npm start

Open http://localhost:3000

## Emails (verification codes)

The server sends the codes through the same EmailJS service you already use.
In EmailJS go to Account > Security, allow API calls from non-browser apps, then paste your
Private Key into `EMAILJS_PRIVATE_KEY` in `.env`.
If the key is empty, the code is printed in the terminal window instead, so you can still test.

## Using PostgreSQL instead of SQLite

1. In `prisma/schema.prisma` change `provider = "sqlite"` to `provider = "postgresql"`.
2. Set `DATABASE_URL` in `.env` to your PostgreSQL connection string.
3. Run `npm run setup` again.

## Hosting

GitHub Pages can only host the front end. To keep the site there, deploy this server to a Node host
(Render, Railway, etc.), set `window.PROLINK_API` in `public/config.js` to its URL, and set
`CORS_ORIGIN` in `.env` to your GitHub Pages address.

## Where things are

- `prisma/schema.prisma`: tables (User, Job, Application, ApplicationDocument, ApplicationEvent, SavedJob, Notification)
- `server/index.js`: all REST endpoints, JWT auth, bcrypt, email codes
- `public/script.js`: the same screens and features as before, now calling the API
- `public/bg.js`: the animated backgrounds (moved out of script.js)
