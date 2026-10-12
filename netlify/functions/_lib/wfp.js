// Спільні хелпери для WayForPay: підпис запитів/відповідей.
// Алгоритм WayForPay: HMAC-MD5(secretKey, поля через ';'), результат — hex у нижньому регістрі.
const crypto = require('crypto');

function wfpSignature(secretKey, fields) {
  const str = fields.join(';');
  return crypto.createHmac('md5', secretKey).update(str, 'utf8').digest('hex');
}

module.exports = { wfpSignature };
