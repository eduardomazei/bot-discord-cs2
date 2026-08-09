const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// --- CONFIGURAÇÃO DO GOOGLE SHEETS ---
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);

async function getSheet(title) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[title];
  if (sheet) await sheet.loadHeaderRow();
  return sheet;
}

module.exports = { doc, getSheet };
