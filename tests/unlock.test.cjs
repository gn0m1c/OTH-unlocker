const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const {transform,manifest,TYPES,main} = require('../unlock.cjs');
const car = manifest.items.find(i=>i.type===1).id;
const cosmetic = manifest.items.find(i=>i.type===3).id;
const upgrade = manifest.items.find(i=>i.type===2).id;
const tool = manifest.items.find(i=>i.type===4).id;
function fixture() {
  return {Header:{Version:17,LastPlayed:'unchanged'},Profile:{Objectives:['keep'],Inventory:{VirtualItems:[{keep:true}],Items:[
    {Type:TYPES.vehicle,Data:{ItemId:car,Count:1,MetersTravelled:42950,InUse:true,ToolsetIDs:[tool]}},
    {Type:TYPES.specific,Data:{ItemId:cosmetic,VehicleStates:[{VehicleItemId:car,Count:2,InUse:true}]}},
    {Type:TYPES.specific,Data:{ItemId:upgrade,VehicleStates:[{VehicleItemId:car,Count:0,InUse:false}]}},
    {Type:TYPES.plain,Data:{ItemId:tool,Count:3,InUse:true}},
    {Type:TYPES.plain,Data:{ItemId:1608550983,Count:1000000}},
    {Type:TYPES.plain,Data:{ItemId:42,Count:5,custom:'unknown preserved'}}
  ]}}};
}
test('catalog has every intended category and unique IDs',()=>{
  const counts = manifest.items.reduce((a,i)=>(a[i.type]=(a[i.type]||0)+1,a),{});
  assert.deepEqual(counts,{0:1,1:21,2:16,3:155,4:7,5:139,6:84});
  assert.equal(new Set(manifest.items.map(i=>i.id)).size,423);
});
test('unlocks every item and per-car state, sets exactly 10000, preserves progress',()=>{
  const original = fixture(), snapshot=structuredClone(original), {save}=transform(original);
  assert.deepEqual(original,snapshot);
  assert.deepEqual(save.Header,original.Header);
  assert.deepEqual(save.Profile.Objectives,original.Profile.Objectives);
  assert.deepEqual(save.Profile.Inventory.VirtualItems,original.Profile.Inventory.VirtualItems);
  const items=save.Profile.Inventory.Items;
  assert.deepEqual(items[0],original.Profile.Inventory.Items[0]);
  assert.deepEqual(items[1].Data.VehicleStates[0],original.Profile.Inventory.Items[1].Data.VehicleStates[0]);
  assert.equal(items[2].Data.VehicleStates[0].Count,1);
  assert.equal(items[2].Data.VehicleStates[0].InUse,false);
  assert.deepEqual(items[3],original.Profile.Inventory.Items[3]);
  assert.equal(items[4].Data.Count,10000);
  assert.deepEqual(items[5],original.Profile.Inventory.Items[5]);
  for (const item of manifest.items) {
    const record=items.find(r=>r.Data.ItemId===item.id); assert(record);
    if ([2,3].includes(item.type)) {
      assert.equal(record.Data.VehicleStates.length,21);
      assert(record.Data.VehicleStates.every(s=>s.Count>0));
      assert(record.Data.VehicleStates.slice(1).every(s=>!s.InUse));
    } else assert(record.Data.Count>0);
    if (item.type===1 && item.id!==car) { assert.deepEqual(record.Data.ToolsetIDs,[tool]); assert(!record.Data.InUse); }
  }
});
test('repeated transformation is idempotent',()=>{
  const first=transform(fixture()).save, second=transform(first);
  assert.deepEqual(second.save,first);
  assert.equal(second.summary.addedItems,0); assert.equal(second.summary.addedVehicleStates,0);
});
test('missing currency, empty inventory, and version 15 are supported',()=>{
  const source=fixture(); source.Header.Version=15; source.Profile.Inventory.Items=[];
  const {save}=transform(source); assert.equal(save.Profile.Inventory.Items.length,423);
  assert.equal(save.Profile.Inventory.Items.find(i=>i.Data.ItemId===1608550983).Data.Count,10000);
});
test('ambiguous and unsupported data fail closed',()=>{
  const bad=fixture(); bad.Header.Version=99; assert.throws(()=>transform(bad),/Unsupported/);
  const duplicate=fixture(); duplicate.Profile.Inventory.Items.push(duplicate.Profile.Inventory.Items[0]); assert.throws(()=>transform(duplicate),/Duplicate/);
  const states=fixture(); states.Profile.Inventory.Items[1].Data.VehicleStates.push({VehicleItemId:car,Count:1}); assert.throws(()=>transform(states),/Duplicate vehicle/);
  const wrong=fixture(); wrong.Profile.Inventory.Items[1].Type=TYPES.plain; assert.throws(()=>transform(wrong),/Unexpected/);
});
test('CLI preview never changes a profile and accepts UTF-8 BOM',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oth-unlocker-test-'));
  try {
    const file=path.join(dir,'Player1.json'), bytes='\uFEFF'+JSON.stringify(fixture()); fs.writeFileSync(file,bytes);
    const output=execFileSync(process.execPath,[path.join(__dirname,'../unlock.cjs'),'--save',file],{encoding:'utf8'});
    assert.match(output,/Preview only/); assert.match(output,/10000/);
    assert.equal(fs.readFileSync(file,'utf8'),bytes);
    const bad=spawnSync(process.execPath,[path.join(__dirname,'../unlock.cjs'),'--save'],{encoding:'utf8'});
    assert.equal(bad.status,1); assert.match(bad.stderr,/Missing value/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('apply and rollback round-trip a synthetic profile with verified backups',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oth-unlocker-test-'));
  const generated=[], log=console.log;
  console.log=()=>{};
  try {
    const file=path.join(dir,'Player1.json'), original=JSON.stringify(fixture());
    fs.writeFileSync(file,original); fs.writeFileSync(file+'.bak','old automatic backup');
    // Synthetic files only: substitute the game-process guard, never the file checks.
    const backup=main(['--save',file,'--apply'],()=>{}); generated.push(backup);
    const info=JSON.parse(fs.readFileSync(path.join(backup,'backup.json')));
    assert.equal(info.saveName,'Player1.json');
    assert.equal(fs.readFileSync(path.join(backup,'Saves','Player1.json'),'utf8'),original);
    assert.equal(JSON.parse(fs.readFileSync(file)).Profile.Inventory.Items.find(i=>i.Data.ItemId===1608550983).Data.Count,10000);
    assert.equal(fs.readFileSync(file+'.bak','utf8'),'old automatic backup');
    generated.push(main(['--save',file,'--restore',backup,'--apply'],()=>{}));
    assert.equal(fs.readFileSync(file,'utf8'),original);
    assert.equal(fs.readFileSync(file+'.bak','utf8'),original);
  } finally {
    console.log=log;
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(dir,{recursive:true,force:true});
    for (const folder of generated) {
      assert.equal(path.dirname(path.resolve(folder)),path.resolve(__dirname,'../backups'));
      fs.rmSync(folder,{recursive:true,force:true});
    }
  }
});
