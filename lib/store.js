"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const DATA_DIR = path.join(__dirname, "..", "data");
const ACTIONS_FILE = path.join(DATA_DIR, "actions.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

let lastBackupAt = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function readActions() {
  try {
    const raw = fs.readFileSync(ACTIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch {
    return [];
  }
}

function writeActions(actions) {
  ensureDirs();
  fs.writeFileSync(ACTIONS_FILE, JSON.stringify({ actions, ok: true }, null, 2), "utf8");
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(actions, pillarIndex) {
  const prefix = `P${pillarIndex >= 0 ? pillarIndex + 1 : 9}`;
  const seq = actions.filter((a) => String(a.id || "").startsWith(prefix)).length + 1;
  return `${prefix}-${String(seq).padStart(2, "0")}`;
}

const COLUMNS = [
  { header: "ID", key: "id", width: 12 },
  { header: "Pillar", key: "pillar", width: 28 },
  { header: "Activity", key: "action", width: 40 },
  { header: "Description", key: "description", width: 45 },
  { header: "Progress Notes", key: "progressText", width: 45 },
  { header: "Help Needed", key: "helpNeeded", width: 35 },
  { header: "Owner", key: "owner", width: 20 },
  { header: "Due Date", key: "dueDate", width: 14 },
  { header: "Status", key: "status", width: 14 },
  { header: "Progress %", key: "progress", width: 12 },
  { header: "Last Update", key: "lastUpdate", width: 14 },
];

async function buildBackupWorkbook(actions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LATAM Cockpit";
  wb.created = new Date();
  const ws = wb.addWorksheet("Activity Plan");
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0176D3" },
  };
  actions.forEach((a) => ws.addRow(a));
  return wb;
}

async function writeBackup(actions) {
  ensureDirs();
  const wb = await buildBackupWorkbook(actions);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_DIR, `backup-${stamp}.xlsx`);
  await wb.xlsx.writeFile(file);
  lastBackupAt = new Date().toISOString();
  return file;
}

async function backupBuffer(actions) {
  const wb = await buildBackupWorkbook(actions);
  lastBackupAt = new Date().toISOString();
  return wb.xlsx.writeBuffer();
}

function getLastBackupAt() {
  return lastBackupAt;
}

module.exports = {
  readActions,
  writeActions,
  todayDate,
  nextId,
  writeBackup,
  backupBuffer,
  getLastBackupAt,
  ensureDirs,
};
