const db = require('./db');

async function all(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows;
}

async function get(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows[0];
}

async function run(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return { lastID: result.lastInsertRowid, changes: result.rowsAffected };
}

module.exports = { all, get, run };
