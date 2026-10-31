#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/items.json'), 'utf8').replace(/^\uFEFF/, ''));
const TYPES = {plain:'InventoryItem, Assembly-CSharp', vehicle:'VehicleItem, Assembly-CSharp', specific:'VehicleSpecificItem, Assembly-CSharp'};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function transform(source) {
  assert(manifest.saveVersions.includes(source.Header?.Version), 'Unsupported save version; supported: 15, 17.');
  assert(Array.isArray(source.Profile?.Inventory?.Items), 'Missing Profile.Inventory.Items.');
  const next = structuredClone(source), items = next.Profile.Inventory.Items;
  const byId = new Map();
  for (const item of items) {
    assert(Number.isInteger(item.Data?.ItemId), 'Invalid inventory item ID.');
    assert(!byId.has(item.Data.ItemId), 'Duplicate inventory item IDs; no changes made.');
    byId.set(item.Data.ItemId, item);
  }
  const cars = manifest.items.filter(i => i.type === 1).map(i => i.id);
  const toolIds = new Set(manifest.items.filter(i => i.type === 4).map(i => i.id));
  // Copy the game's active tool assignments only for newly created vehicles.
  const activeTools = items.filter(i => toolIds.has(i.Data.ItemId) && i.Data.Count > 0 && i.Data.InUse).map(i => i.Data.ItemId);
  let added = 0, statesAdded = 0, countsRaised = 0;
  for (const entry of manifest.items) {
    const expected = entry.type === 1 ? TYPES.vehicle : [2,3].includes(entry.type) ? TYPES.specific : TYPES.plain;
    let record = byId.get(entry.id);
    if (!record) {
      record = {Type:expected, Data:{ItemId:entry.id, IsNew:true}};
      if (expected === TYPES.specific) record.Data.VehicleStates = [];
      if (expected === TYPES.vehicle) record.Data.ToolsetIDs = [...activeTools];
      items.push(record); byId.set(entry.id, record); added++;
    }
    assert.equal(record.Type, expected, `Unexpected record type for ${entry.name}.`);
    if (expected === TYPES.specific) {
      assert(Array.isArray(record.Data.VehicleStates), `Invalid vehicle states for ${entry.name}.`);
      const states = new Map();
      for (const state of record.Data.VehicleStates) {
        assert(Number.isInteger(state.VehicleItemId), 'Invalid vehicle state ID.');
        assert(!states.has(state.VehicleItemId), 'Duplicate vehicle states; no changes made.');
        assert(state.Count === undefined || (Number.isInteger(state.Count) && state.Count >= 0), 'Invalid state count.');
        states.set(state.VehicleItemId, state);
      }
      for (const id of cars) {
        let state = states.get(id);
        if (!state) {
          state = {VehicleItemId:id, Count:1}; record.Data.VehicleStates.push(state); statesAdded++;
        } else if (!(state.Count > 0)) { state.Count = 1; countsRaised++; }
      }
    } else {
      assert(record.Data.Count === undefined || (Number.isInteger(record.Data.Count) && record.Data.Count >= 0), 'Invalid item count.');
      if (entry.type === 0) record.Data.Count = 10000;
      else if (!(record.Data.Count > 0)) { record.Data.Count = 1; countsRaised++; }
    }
  }
  // Check all content and ensure nothing outside the inventory changed.
  for (const entry of manifest.items) {
    const record = byId.get(entry.id);
    if ([2,3].includes(entry.type)) for (const car of cars) assert(record.Data.VehicleStates.some(s => s.VehicleItemId === car && s.Count > 0));
    else if (entry.type === 0) assert.equal(record.Data.Count,10000);
    else assert(record.Data.Count > 0);
  }
  const stripped = structuredClone(next); stripped.Profile.Inventory.Items = source.Profile.Inventory.Items;
  assert.deepEqual(stripped, source);
  return {save:next, summary:{addedItems:added, addedVehicleStates:statesAdded, raisedOwnershipCounts:countsRaised, currency:10000, catalogItems:manifest.items.length}};
}

function ensureClosed() {
  assert.equal(process.platform, 'win32', 'Live editing requires Windows.');
  const output = execFileSync('powershell.exe', ['-NoProfile','-Command', "if (Get-Process -Name 'over the hill' -ErrorAction SilentlyContinue) { 'RUNNING' } else { 'CLOSED' }"], {encoding:'utf8', windowsHide:true}).trim();
  assert.equal(output, 'CLOSED', 'Close Over the Hill normally, then try again.');
}
function defaultSave() {
  let documents = path.join(os.homedir(), 'Documents');
  if (process.platform === 'win32') documents = execFileSync('powershell.exe', ['-NoProfile','-Command', "[Environment]::GetFolderPath('MyDocuments')"], {encoding:'utf8', windowsHide:true}).trim();
  return path.join(documents, 'My Games', 'over the hill', 'Saves', 'Player1.json');
}
function backup(savePath) {
  const dir = path.join(__dirname, 'backups', new Date().toISOString().replace(/[:.]/g,'-') + '-' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(dir, {recursive:true});
  const saves = path.join(dir,'Saves');
  fs.cpSync(path.dirname(savePath), saves, {recursive:true, errorOnExist:true, force:false});
  const hashes = {};
  function walk(source, relative='') {
    for (const entry of fs.readdirSync(source, {withFileTypes:true})) {
      const rel = path.join(relative, entry.name), original = path.join(source, entry.name);
      if (entry.isDirectory()) walk(original, rel);
      else if (entry.isFile()) {
        const digest = hash(fs.readFileSync(original));
        assert.equal(hash(fs.readFileSync(path.join(saves,rel))), digest, 'Backup verification failed.');
        hashes[rel] = digest;
      } else throw Error('Unsupported link in Saves directory.');
    }
  }
  walk(path.dirname(savePath));
  fs.writeFileSync(path.join(dir,'backup.json'), JSON.stringify({saveName:path.basename(savePath), hashes},null,2));
  return dir;
}
function atomicWrite(file, bytes) {
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp,file);
    assert.equal(hash(fs.readFileSync(file)), hash(bytes), 'Written hash mismatch.');
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function main(args, checkClosed = ensureClosed) {
  let apply = false, restore, savePath;
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (['--save','--restore'].includes(args[i])) {
      const flag = args[i], value = args[++i]; assert(value && !value.startsWith('--'), `Missing value for ${flag}.`);
      if (flag === '--save') savePath = value; else restore = value;
    } else if (['--help','-h'].includes(args[i])) {
      console.log('node unlock.cjs [--apply] [--save PATH]\nnode unlock.cjs --restore BACKUP_FOLDER [--apply] [--save PATH]\nWithout --apply, only previews. Currency is set to exactly 10,000.'); return;
    } else throw Error(`Unknown option: ${args[i]}`);
  }
  savePath = path.resolve(savePath || defaultSave());
  assert.equal(path.extname(savePath).toLowerCase(), '.json', 'Select a profile JSON file.');
  const relativeRepo = path.relative(path.dirname(savePath),__dirname);
  assert(relativeRepo.startsWith('..' + path.sep) || relativeRepo === '..' || path.isAbsolute(relativeRepo), 'Repository must be outside the Saves folder.');
  if (apply) checkClosed();
  const original = fs.readFileSync(savePath), source = JSON.parse(original.toString('utf8').replace(/^\uFEFF/,''));
  let bytes, summary;
  if (restore) {
    const folder = path.resolve(restore), info = read(path.join(folder,'backup.json'));
    assert.equal(info.saveName,path.basename(savePath), 'Backup profile name does not match.');
    bytes = fs.readFileSync(path.join(folder,'Saves',path.basename(savePath)));
    assert.equal(hash(bytes),info.hashes[path.basename(savePath)],'Backup hash mismatch.');
    const restored = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    assert(Array.isArray(restored.Profile?.Inventory?.Items), 'Invalid backup profile.');
    summary = {restore:folder, note:'Restores profile progress to the backup time; other Saves files are untouched.'};
  } else {
    const result = transform(source); summary = result.summary;
    bytes = Buffer.from(JSON.stringify(result.save));
    if (JSON.stringify(result.save) === JSON.stringify(source)) { console.log('Already unlocked with exactly 10,000 currency. No changes needed.'); return; }
  }
  console.log(JSON.stringify({save:savePath, ...summary, mode:apply ? 'apply' : 'preview'},null,2));
  if (!apply) { console.log('Preview only. Add --apply to back up and write.'); return; }
  const dir = backup(savePath);
  // Reject changes made since inspection, including a game/cloud save during backup.
  checkClosed();
  assert.equal(hash(fs.readFileSync(savePath)),hash(original),'Save changed; run again using the latest progress.');
  atomicWrite(savePath,bytes);
  // Restore also replaces the automatic fallback so it cannot reload modified progress.
  if (restore) atomicWrite(savePath + '.bak',bytes);
  fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify({action:restore?'restore':'unlock',before:hash(original),after:hash(bytes),summary},null,2));
  console.log(`Verified. Backup: ${dir}`);
  return dir;
}
module.exports = {transform, manifest, TYPES, hash, main};
if (require.main === module) try { main(process.argv.slice(2)); } catch (error) { console.error(`Stopped: ${error.message}`); process.exitCode = 1; }
