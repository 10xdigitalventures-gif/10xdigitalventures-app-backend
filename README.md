# 10x Chat - Backend

## Setup

1. Install dependencies:
```
npm install
```

2. Edit `.env` with your Hostinger PostgreSQL (Neon) credentials

3. Import database:
```
psql $DATABASE_URL < schema_pg.sql
```

4. Create uploads folder (already included)

5. Run:
```
npm start
```

## Hostinger Deploy
- Upload all files via FTP or Git
- Run: npm install && npm start
- Use PM2: pm2 start server.js --name 10x-chat
- Nginx reverse proxy to port 5000
