'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const api = require('./routes/api');

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`RetailCLIQ Universal Import  →  http://localhost:${port}`);
  console.log(`SQL ${process.env.SQL_SERVER},${process.env.SQL_PORT}  new=${process.env.DB_NEW}  old=${process.env.DB_OLD}  mode=${process.env.POST_MODE || 'LEGACY'}`);
});
