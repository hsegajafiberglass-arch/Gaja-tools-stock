const express=require('express');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const multer=require('multer');
const QRCode=require('qrcode');
const PDFDocument=require('pdfkit');
const path=require('path');
const fs=require('fs');

const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'CHANGE_ME_GAJA_PRODUCTION_SECRET';
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const DB_PATH=process.env.DB_PATH||path.join(DATA_DIR,'warehouse.db');
const UPLOAD_DIR=process.env.UPLOAD_DIR||path.join(DATA_DIR,'uploads');
fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const db=new Database(DB_PATH); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','warehouse','viewer')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category_id INTEGER,brand TEXT DEFAULT '',stock INTEGER NOT NULL DEFAULT 0,min_stock INTEGER NOT NULL DEFAULT 0,unit TEXT DEFAULT 'Unit',condition TEXT DEFAULT 'Baik',location TEXT DEFAULT '',serial_no TEXT DEFAULT '',notes TEXT DEFAULT '',photo_path TEXT DEFAULT '',asset_status TEXT DEFAULT 'Gudang',current_project TEXT DEFAULT '',current_holder TEXT DEFAULT '',updated_at TEXT DEFAULT (datetime('now')),FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,tx_date TEXT NOT NULL,tx_type TEXT NOT NULL CHECK(tx_type IN ('IN','OUT')),item_id INTEGER NOT NULL,qty INTEGER NOT NULL,stock_before INTEGER NOT NULL,stock_after INTEGER NOT NULL,source_target TEXT DEFAULT '',pic TEXT DEFAULT '',document_no TEXT DEFAULT '',notes TEXT DEFAULT '',created_by INTEGER,created_at TEXT DEFAULT (datetime('now')),FOREIGN KEY(item_id) REFERENCES items(id),FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS transfer_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,request_date TEXT NOT NULL,item_id INTEGER NOT NULL,qty INTEGER NOT NULL,project TEXT NOT NULL,receiver TEXT NOT NULL,document_no TEXT DEFAULT '',purpose TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','RETURNED')),requested_by INTEGER NOT NULL,approved_by INTEGER,approval_note TEXT DEFAULT '',approved_at TEXT,created_at TEXT DEFAULT (datetime('now')),FOREIGN KEY(item_id) REFERENCES items(id),FOREIGN KEY(requested_by) REFERENCES users(id),FOREIGN KEY(approved_by) REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_req_status ON transfer_requests(status);
`);

if(!db.prepare('SELECT COUNT(*) c FROM users').get().c){db.prepare('INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)').run('Administrator','admin',bcrypt.hashSync('Admin123!',10),'admin');}
['Power Tools','Hand Tools','Safety Equipment','Lifting Equipment','Electrical','Consumable'].forEach(x=>db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(x));

app.use(express.json({limit:'2mb'})); app.use('/uploads',express.static(UPLOAD_DIR)); app.use(express.static(path.join(__dirname,'public')));
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,UPLOAD_DIR),filename:(req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase()||'.jpg';cb(null,`item_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`)}});
const upload=multer({storage,limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,/image\/(png|jpeg|webp)/.test(file.mimetype))});

function auth(req,res,next){const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):null;if(!t)return res.status(401).json({error:'Unauthorized'});try{req.user=jwt.verify(t,JWT_SECRET);next()}catch(e){res.status(401).json({error:'Session expired'})}}
const allow=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Akses ditolak'});
function itemRow(id){return db.prepare(`SELECT i.*,c.name category FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE i.id=?`).get(id)}
function logTx({date,type,item,qty,target,pic,doc,notes,userId}){const before=item.stock,after=type==='IN'?before+qty:before-qty;if(after<0)throw new Error('Stok tidak cukup');db.prepare('UPDATE items SET stock=?,updated_at=datetime(\'now\') WHERE id=?').run(after,item.id);db.prepare(`INSERT INTO transactions(tx_date,tx_type,item_id,qty,stock_before,stock_after,source_target,pic,document_no,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(date,type,item.id,qty,before,after,target||'',pic||'',doc||'',notes||'',userId);return after}

app.post('/api/login',(req,res)=>{const {username,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);if(!u||!bcrypt.compareSync(password||'',u.password_hash))return res.status(401).json({error:'Username atau password salah'});const user={id:u.id,name:u.name,username:u.username,role:u.role};res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'12h'}),user})});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/dashboard',auth,(req,res)=>{const base=db.prepare(`SELECT COUNT(*) item_count,COALESCE(SUM(stock),0) stock_total,SUM(CASE WHEN stock<=min_stock THEN 1 ELSE 0 END) low_count,SUM(CASE WHEN asset_status='Maintenance' THEN 1 ELSE 0 END) maintenance_count FROM items`).get();const ym=new Date().toISOString().slice(0,7);const monthTx=db.prepare('SELECT COUNT(*) c FROM transactions WHERE substr(tx_date,1,7)=?').get(ym).c;const pending=db.prepare("SELECT COUNT(*) c FROM transfer_requests WHERE status='PENDING'").get().c;const recent=db.prepare(`SELECT t.*,i.code,i.name item_name,u.name creator_name FROM transactions t JOIN items i ON i.id=t.item_id LEFT JOIN users u ON u.id=t.created_by ORDER BY t.tx_date DESC,t.id DESC LIMIT 8`).all();const alerts=db.prepare(`SELECT i.id,i.code,i.name,i.stock,i.min_stock,i.unit,i.asset_status,c.name category FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE i.stock<=i.min_stock OR i.asset_status IN ('Maintenance','Rusak') ORDER BY CASE WHEN i.stock=0 THEN 0 ELSE 1 END,i.stock`).all();res.json({...base,monthTx,pending,recent,alerts})});

app.get('/api/categories',auth,(req,res)=>res.json(db.prepare('SELECT c.*,COUNT(i.id) item_count FROM categories c LEFT JOIN items i ON i.category_id=c.id GROUP BY c.id ORDER BY c.name').all()));
app.post('/api/categories',auth,allow('admin','warehouse'),(req,res)=>{try{const r=db.prepare('INSERT INTO categories(name) VALUES(?)').run((req.body.name||'').trim());res.json({id:r.lastInsertRowid})}catch(e){res.status(400).json({error:'Kategori tidak valid / sudah ada'})}});
app.put('/api/categories/:id',auth,allow('admin','warehouse'),(req,res)=>{try{db.prepare('UPDATE categories SET name=? WHERE id=?').run((req.body.name||'').trim(),req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:'Kategori tidak valid / sudah ada'})}});
app.delete('/api/categories/:id',auth,allow('admin'),(req,res)=>{if(db.prepare('SELECT COUNT(*) c FROM items WHERE category_id=?').get(req.params.id).c)return res.status(400).json({error:'Kategori masih digunakan'});db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);res.json({ok:true})});

app.get('/api/items',auth,(req,res)=>res.json(db.prepare(`SELECT i.*,c.name category FROM items i LEFT JOIN categories c ON c.id=i.category_id ORDER BY i.name`).all()));
app.post('/api/items',auth,allow('admin','warehouse'),(req,res)=>{const b=req.body;if(!b.code?.trim()||!b.name?.trim())return res.status(400).json({error:'Kode dan nama alat wajib'});try{const r=db.prepare(`INSERT INTO items(code,name,category_id,brand,stock,min_stock,unit,condition,location,serial_no,notes,asset_status,current_project,current_holder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.code.trim(),b.name.trim(),b.category_id||null,b.brand||'',+b.stock||0,+b.min_stock||0,b.unit||'Unit',b.condition||'Baik',b.location||'',b.serial_no||'',b.notes||'',b.asset_status||'Gudang',b.current_project||'',b.current_holder||'');res.json({id:r.lastInsertRowid})}catch(e){res.status(400).json({error:'Kode alat sudah digunakan / data tidak valid'})}});
app.put('/api/items/:id',auth,allow('admin','warehouse'),(req,res)=>{const b=req.body;try{db.prepare(`UPDATE items SET code=?,name=?,category_id=?,brand=?,stock=?,min_stock=?,unit=?,condition=?,location=?,serial_no=?,notes=?,asset_status=?,current_project=?,current_holder=?,updated_at=datetime('now') WHERE id=?`).run(b.code.trim(),b.name.trim(),b.category_id||null,b.brand||'',+b.stock||0,+b.min_stock||0,b.unit||'Unit',b.condition||'Baik',b.location||'',b.serial_no||'',b.notes||'',b.asset_status||'Gudang',b.current_project||'',b.current_holder||'',req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:'Data item tidak valid / kode sudah digunakan'})}});
app.delete('/api/items/:id',auth,allow('admin'),(req,res)=>{if(db.prepare('SELECT COUNT(*) c FROM transactions WHERE item_id=?').get(req.params.id).c)return res.status(400).json({error:'Item memiliki histori transaksi'});db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);res.json({ok:true})});
app.post('/api/items/:id/photo',auth,allow('admin','warehouse'),upload.single('photo'),(req,res)=>{if(!req.file)return res.status(400).json({error:'File foto tidak valid'});const old=db.prepare('SELECT photo_path FROM items WHERE id=?').get(req.params.id);db.prepare('UPDATE items SET photo_path=?,updated_at=datetime(\'now\') WHERE id=?').run('/uploads/'+req.file.filename,req.params.id);if(old?.photo_path){try{fs.unlinkSync(path.join(UPLOAD_DIR,path.basename(old.photo_path)))}catch(e){}}res.json({photo_path:'/uploads/'+req.file.filename})});
app.get('/api/items/:id/qr',auth,async(req,res)=>{const i=itemRow(req.params.id);if(!i)return res.status(404).end();const base=process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`;const payload=`${base}/?asset=${encodeURIComponent(i.code)}`;res.type('png');res.send(await QRCode.toBuffer(payload,{width:420,margin:2}))});

app.get('/api/transactions',auth,(req,res)=>res.json(db.prepare(`SELECT t.*,i.code,i.name item_name,i.unit,u.name creator_name FROM transactions t JOIN items i ON i.id=t.item_id LEFT JOIN users u ON u.id=t.created_by ORDER BY t.tx_date DESC,t.id DESC`).all()));
app.post('/api/transactions',auth,allow('admin','warehouse'),(req,res)=>{const b=req.body,qty=+b.qty;try{const run=db.transaction(()=>{const i=db.prepare('SELECT * FROM items WHERE id=?').get(b.item_id);if(!i||qty<=0)throw new Error('Data transaksi tidak valid');const after=logTx({date:b.tx_date,type:b.tx_type,item:i,qty,target:b.source_target,pic:b.pic,doc:b.document_no,notes:b.notes,userId:req.user.id});if(b.tx_type==='IN'&&b.set_status)db.prepare(`UPDATE items SET asset_status=?,current_project=?,current_holder=? WHERE id=?`).run(b.set_status,b.set_status==='Project'?(b.source_target||''):'',b.set_status==='Dipinjam'?(b.pic||''):'',i.id);return after});res.json({stock_after:run()})}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/transfers',auth,(req,res)=>res.json(db.prepare(`SELECT r.*,i.code,i.name item_name,i.unit,ru.name requester,au.name approver FROM transfer_requests r JOIN items i ON i.id=r.item_id LEFT JOIN users ru ON ru.id=r.requested_by LEFT JOIN users au ON au.id=r.approved_by ORDER BY r.id DESC`).all()));
app.post('/api/transfers',auth,allow('admin','warehouse'),(req,res)=>{const b=req.body;if(!b.item_id||+b.qty<=0||!b.project?.trim()||!b.receiver?.trim())return res.status(400).json({error:'Alat, jumlah, project, dan penerima wajib diisi'});const i=db.prepare('SELECT stock FROM items WHERE id=?').get(b.item_id);if(!i||+b.qty>i.stock)return res.status(400).json({error:'Stok tidak mencukupi'});const r=db.prepare(`INSERT INTO transfer_requests(request_date,item_id,qty,project,receiver,document_no,purpose,requested_by) VALUES(?,?,?,?,?,?,?,?)`).run(b.request_date,b.item_id,+b.qty,b.project.trim(),b.receiver.trim(),b.document_no||'',b.purpose||'',req.user.id);res.json({id:r.lastInsertRowid})});
app.post('/api/transfers/:id/approve',auth,allow('admin'),(req,res)=>{try{db.transaction(()=>{const r=db.prepare('SELECT * FROM transfer_requests WHERE id=?').get(req.params.id);if(!r||r.status!=='PENDING')throw new Error('Request tidak dapat diproses');const i=db.prepare('SELECT * FROM items WHERE id=?').get(r.item_id);if(r.qty>i.stock)throw new Error('Stok saat approval tidak mencukupi');logTx({date:r.request_date,type:'OUT',item:i,qty:r.qty,target:r.project,pic:r.receiver,doc:r.document_no,notes:'Approved handover: '+r.purpose,userId:req.user.id});db.prepare(`UPDATE transfer_requests SET status='APPROVED',approved_by=?,approval_note=?,approved_at=datetime('now') WHERE id=?`).run(req.user.id,req.body.note||'',r.id);db.prepare(`UPDATE items SET asset_status='Project',current_project=?,current_holder=? WHERE id=?`).run(r.project,r.receiver,r.item_id)})() ;res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/transfers/:id/reject',auth,allow('admin'),(req,res)=>{const r=db.prepare("UPDATE transfer_requests SET status='REJECTED',approved_by=?,approval_note=?,approved_at=datetime('now') WHERE id=? AND status='PENDING'").run(req.user.id,req.body.note||'',req.params.id);if(!r.changes)return res.status(400).json({error:'Request tidak dapat ditolak'});res.json({ok:true})});
app.post('/api/transfers/:id/return',auth,allow('admin','warehouse'),(req,res)=>{try{db.transaction(()=>{const r=db.prepare('SELECT * FROM transfer_requests WHERE id=?').get(req.params.id);if(!r||r.status!=='APPROVED')throw new Error('Request belum approved / sudah dikembalikan');const i=db.prepare('SELECT * FROM items WHERE id=?').get(r.item_id);logTx({date:req.body.return_date,type:'IN',item:i,qty:r.qty,target:'Gudang',pic:req.user.name,doc:r.document_no,notes:'Pengembalian dari '+r.project,userId:req.user.id});db.prepare("UPDATE transfer_requests SET status='RETURNED' WHERE id=?").run(r.id);db.prepare("UPDATE items SET asset_status='Gudang',current_project='',current_holder='' WHERE id=?").run(r.item_id)})() ;res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/users',auth,allow('admin'),(req,res)=>res.json(db.prepare('SELECT id,name,username,role,active,created_at FROM users ORDER BY name').all()));
app.post('/api/users',auth,allow('admin'),(req,res)=>{const b=req.body;if(!b.name||!b.username||!b.password)return res.status(400).json({error:'Data user belum lengkap'});try{const r=db.prepare('INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)').run(b.name,b.username,bcrypt.hashSync(b.password,10),b.role);res.json({id:r.lastInsertRowid})}catch(e){res.status(400).json({error:'Username sudah digunakan'})}});
app.put('/api/users/:id',auth,allow('admin'),(req,res)=>{const b=req.body;if(b.password)db.prepare('UPDATE users SET name=?,role=?,active=?,password_hash=? WHERE id=?').run(b.name,b.role,b.active?1:0,bcrypt.hashSync(b.password,10),req.params.id);else db.prepare('UPDATE users SET name=?,role=?,active=? WHERE id=?').run(b.name,b.role,b.active?1:0,req.params.id);res.json({ok:true})});

function monthlyReportData(month){
  const tx=db.prepare(`SELECT t.*,i.code,i.name item_name,i.unit,c.name category,u.name creator FROM transactions t JOIN items i ON i.id=t.item_id LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN users u ON u.id=t.created_by WHERE substr(t.tx_date,1,7)=? ORDER BY t.tx_date,t.id`).all(month);
  const items=db.prepare(`SELECT i.*,c.name category FROM items i LEFT JOIN categories c ON c.id=i.category_id ORDER BY COALESCE(c.name,''),i.name`).all();
  const transfers=db.prepare(`SELECT r.*,i.code,i.name item_name,i.unit,ru.name requester,au.name approver FROM transfer_requests r JOIN items i ON i.id=r.item_id LEFT JOIN users ru ON ru.id=r.requested_by LEFT JOIN users au ON au.id=r.approved_by WHERE substr(r.request_date,1,7)=? ORDER BY r.request_date,r.id`).all(month);
  const totalIn=tx.filter(x=>x.tx_type==='IN').reduce((a,b)=>a+b.qty,0);
  const totalOut=tx.filter(x=>x.tx_type==='OUT').reduce((a,b)=>a+b.qty,0);
  const low=items.filter(x=>x.stock<=x.min_stock);
  const maint=items.filter(x=>x.asset_status==='Maintenance');
  const broken=items.filter(x=>x.asset_status==='Rusak');
  const project=items.filter(x=>x.asset_status==='Project');
  const borrowed=items.filter(x=>x.asset_status==='Dipinjam');
  const categories={};
  tx.forEach(t=>{const k=t.category||'Tanpa Kategori';if(!categories[k])categories[k]={category:k,in_qty:0,out_qty:0};categories[k][t.tx_type==='IN'?'in_qty':'out_qty']+=t.qty});
  const topOut=Object.values(tx.filter(t=>t.tx_type==='OUT').reduce((a,t)=>{if(!a[t.item_id])a[t.item_id]={code:t.code,name:t.item_name,unit:t.unit,qty:0};a[t.item_id].qty+=t.qty;return a},{})).sort((a,b)=>b.qty-a.qty).slice(0,10);
  return {tx,items,transfers,totalIn,totalOut,low,maint,broken,project,borrowed,categories:Object.values(categories).sort((a,b)=>a.category.localeCompare(b.category)),topOut};
}
function monthLabel(month){const [y,m]=month.split('-').map(Number);const names=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];return `${names[m-1]||m} ${y}`}
function fmtDateID(s){if(!s)return '-';const [y,m,d]=s.slice(0,10).split('-');return `${d}/${m}/${y}`}
app.get('/api/reports/monthly-summary',auth,(req,res)=>{const month=req.query.month||new Date().toISOString().slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))return res.status(400).json({error:'Periode tidak valid'});const d=monthlyReportData(month);res.json({period:month,label:monthLabel(month),kpi:{itemTypes:d.items.length,totalStock:d.items.reduce((a,b)=>a+b.stock,0),totalIn:d.totalIn,totalOut:d.totalOut,lowStock:d.low.length,project:d.project.length,borrowed:d.borrowed.length,maintenance:d.maint.length,broken:d.broken.length,transactions:d.tx.length},categories:d.categories,topOut:d.topOut,lowStock:d.low.slice(0,20).map(i=>({code:i.code,name:i.name,stock:i.stock,min_stock:i.min_stock,unit:i.unit,category:i.category})),projects:d.items.filter(i=>i.asset_status==='Project'||i.asset_status==='Dipinjam').map(i=>({code:i.code,name:i.name,status:i.asset_status,project:i.current_project,holder:i.current_holder,stock:i.stock,unit:i.unit})),transfers:d.transfers.slice(0,25).map(r=>({date:r.request_date,code:r.code,name:r.item_name,qty:r.qty,unit:r.unit,project:r.project,receiver:r.receiver,status:r.status}))})});

app.get('/api/reports/monthly.pdf',auth,(req,res)=>{
  const month=req.query.month||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(month))return res.status(400).json({error:'Periode tidak valid'});
  const d=monthlyReportData(month), label=monthLabel(month), [yy,mm]=month.split('-');
  const docNo=`GAJA/WH/MR/${yy}/${mm}`;
  const doc=new PDFDocument({size:'A4',margin:34,bufferPages:true,info:{Title:`Monthly Warehouse & Tools Report - ${label}`,Author:'PT Graha Adhi Jaya Abadi',Subject:'Warehouse Stock Control'}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=GAJA_Monthly_Warehouse_Report_${month}.pdf`);
  doc.pipe(res);
  const W=doc.page.width, H=doc.page.height, L=34, R=W-34, blue='#163a5f', light='#eaf1f7', dark='#172033', muted='#66758a', green='#15735b', orange='#b66b00', red='#b42318';
  function header(title='MONTHLY WAREHOUSE & TOOLS REPORT'){
    doc.save().rect(0,0,W,76).fill(blue).restore();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('GAJA',L,20,{width:55});
    doc.fontSize(10).text('PT GRAHA ADHI JAYA ABADI',95,18,{width:300});
    doc.font('Helvetica').fontSize(7.5).text('Warehouse & Asset Control System',95,34,{width:300});
    doc.font('Helvetica-Bold').fontSize(9).text(title,L,55,{width:R-L,align:'right'});
    doc.fillColor(dark);
  }
  function footer(pageNum){doc.font('Helvetica').fontSize(7).fillColor(muted).text(`${docNo}  |  Rev. 00  |  Generated ${new Date().toLocaleDateString('id-ID')}`,L,H-28,{width:R-L-70});doc.text(`Page ${pageNum}`,R-60,H-28,{width:60,align:'right'});doc.moveTo(L,H-34).lineTo(R,H-34).strokeColor('#d9e2ea').stroke();doc.fillColor(dark)}
  function page(title){if(doc.page.number>1)doc.addPage();header(title);doc.y=92}
  function section(t){if(doc.y>710){doc.addPage();header();doc.y=92}doc.moveDown(.35).font('Helvetica-Bold').fontSize(11).fillColor(blue).text(t);doc.moveDown(.35).fillColor(dark)}
  function box(x,y,w,h,labelTxt,value,sub='',accent=blue){doc.roundedRect(x,y,w,h,6).fillAndStroke('#ffffff','#dce5ed');doc.rect(x,y,4,h).fill(accent);doc.fillColor(muted).font('Helvetica-Bold').fontSize(6.8).text(labelTxt.toUpperCase(),x+12,y+10,{width:w-20});doc.fillColor(dark).fontSize(17).text(String(value),x+12,y+23,{width:w-20});if(sub)doc.font('Helvetica').fontSize(6.8).fillColor(muted).text(sub,x+12,y+h-14,{width:w-20});doc.fillColor(dark)}
  function table(headers,rows,widths,opts={}){const rowH=opts.rowH||18, fontSize=opts.fontSize||7.2;let y=doc.y;const total=widths.reduce((a,b)=>a+b,0);function drawHead(){doc.rect(L,y,total,rowH).fill(blue);let x=L;headers.forEach((h,i)=>{doc.fillColor('#fff').font('Helvetica-Bold').fontSize(fontSize).text(h,x+4,y+5,{width:widths[i]-8,height:rowH-6});x+=widths[i]});doc.fillColor(dark);y+=rowH}drawHead();rows.forEach((row,ri)=>{if(y+rowH>H-45){doc.addPage();header();y=92;drawHead()}if(ri%2===0)doc.rect(L,y,total,rowH).fill('#f7f9fb');let x=L;row.forEach((v,i)=>{doc.fillColor(dark).font('Helvetica').fontSize(fontSize).text(String(v??'-'),x+4,y+4,{width:widths[i]-8,height:rowH-5,ellipsis:true});x+=widths[i]});doc.strokeColor('#e2e8ef').moveTo(L,y+rowH).lineTo(L+total,y+rowH).stroke();y+=rowH});doc.y=y+5}
  function barChart(data){if(!data.length){doc.fontSize(8).fillColor(muted).text('Tidak ada pergerakan stok pada periode ini.');doc.fillColor(dark);return}const max=Math.max(1,...data.flatMap(x=>[x.in_qty,x.out_qty])), chartW=R-L-130;data.slice(0,10).forEach(x=>{if(doc.y>700){doc.addPage();header();doc.y=92}const y=doc.y;doc.font('Helvetica').fontSize(7).fillColor(dark).text(x.category,L,y,{width:120,ellipsis:true});const bx=L+125;doc.rect(bx,y,chartW,6).fill('#eef2f6');doc.rect(bx,y,chartW*(x.in_qty/max),6).fill(green);doc.rect(bx,y+8,chartW*(x.out_qty/max),6).fill(red);doc.fontSize(6.5).fillColor(muted).text(`IN ${x.in_qty}   OUT ${x.out_qty}`,bx+chartW+5,y,{width:90});doc.y=y+22});doc.fillColor(dark)}

  // Cover / executive summary
  header();
  doc.y=98;doc.font('Helvetica-Bold').fontSize(20).fillColor(blue).text('LAPORAN BULANAN GUDANG & ALAT KERJA');doc.font('Helvetica').fontSize(11).fillColor(muted).text(`Periode ${label}`);doc.moveDown(.4);
  doc.roundedRect(L,150,R-L,54,6).fillAndStroke(light,'#d2dfeb');doc.fillColor(dark).font('Helvetica-Bold').fontSize(8).text('INFORMASI DOKUMEN',L+12,160);doc.font('Helvetica').fontSize(8).text(`Nomor Dokumen : ${docNo}\nRevisi : 00\nDisiapkan oleh : ${req.user.name} (${req.user.role})`,L+12,174,{columns:2,columnGap:50,width:R-L-24});
  const bw=(R-L-18)/4;let by=224;box(L,by,bw,68,'Jenis Alat',d.items.length,'master item');box(L+bw+6,by,bw,68,'Total Stok',d.items.reduce((a,b)=>a+b.stock,0),'unit tersedia',green);box(L+(bw+6)*2,by,bw,68,'Barang Masuk',d.totalIn,`${d.tx.filter(x=>x.tx_type==='IN').length} transaksi`,green);box(L+(bw+6)*3,by,bw,68,'Barang Keluar',d.totalOut,`${d.tx.filter(x=>x.tx_type==='OUT').length} transaksi`,red);
  by=302;box(L,by,bw,68,'Perlu Restock',d.low.length,'stok ≤ minimum',orange);box(L+bw+6,by,bw,68,'Di Project',d.project.length,'jenis alat',blue);box(L+(bw+6)*2,by,bw,68,'Maintenance',d.maint.length,'jenis alat',orange);box(L+(bw+6)*3,by,bw,68,'Rusak',d.broken.length,'jenis alat',red);
  doc.y=392;section('Executive Summary');
  const net=d.totalIn-d.totalOut;doc.font('Helvetica').fontSize(9).fillColor(dark).text(`Pada periode ${label}, tercatat ${d.tx.length} transaksi stok dengan total ${d.totalIn} unit masuk dan ${d.totalOut} unit keluar. Pergerakan bersih periode adalah ${net>=0?'+':''}${net} unit. Saat laporan dibuat terdapat ${d.low.length} item pada atau di bawah minimum stock, ${d.project.length} item berstatus Project, ${d.borrowed.length} Dipinjam, ${d.maint.length} Maintenance, dan ${d.broken.length} Rusak.`,{lineGap:3});
  section('Pergerakan Stok per Kategori');barChart(d.categories);

  // Inventory status
  doc.addPage();header('01  INVENTORY STATUS');doc.y=92;section('Posisi Stok & Status Alat');
  table(['Kode','Nama Alat','Kategori','Stok','Min','Satuan','Status'],d.items.map(i=>[i.code,i.name,i.category||'-',i.stock,i.min_stock,i.unit,i.asset_status]),[62,150,90,38,35,45,87],{fontSize:6.8,rowH:17});

  // Low stock
  doc.addPage();header('02  RESTOCK & EXCEPTION');doc.y=92;section('Daftar Prioritas Restock');
  if(d.low.length)table(['No','Kode','Nama Alat','Kategori','Stok','Minimum','Gap'],d.low.map((i,n)=>[n+1,i.code,i.name,i.category||'-',`${i.stock} ${i.unit}`,i.min_stock,Math.max(0,i.min_stock-i.stock)]),[28,65,150,95,62,55,52],{fontSize:7,rowH:18});else doc.fontSize(9).fillColor(green).text('Tidak ada item yang berada pada atau di bawah minimum stock.');
  section('Maintenance & Rusak');
  const exceptions=[...d.maint,...d.broken];if(exceptions.length)table(['Kode','Nama','Kategori','Status','Lokasi','Catatan'],exceptions.map(i=>[i.code,i.name,i.category||'-',i.asset_status,i.location||'-',i.notes||'-']),[65,135,90,65,80,74],{fontSize:6.8,rowH:19});else doc.fontSize(9).fillColor(green).text('Tidak ada alat berstatus Maintenance atau Rusak.');

  // Projects/borrowed
  doc.addPage();header('03  PROJECT DISTRIBUTION');doc.y=92;section('Alat di Project / Dipinjam');
  const deployed=d.items.filter(i=>['Project','Dipinjam'].includes(i.asset_status));if(deployed.length)table(['Kode','Nama Alat','Status','Project/Tujuan','Holder/PIC','Stok'],deployed.map(i=>[i.code,i.name,i.asset_status,i.current_project||'-',i.current_holder||'-',`${i.stock} ${i.unit}`]),[65,135,65,110,105,55],{fontSize:6.8,rowH:19});else doc.fontSize(9).fillColor(muted).text('Tidak ada alat yang sedang berada di project atau dipinjam.');
  section('Serah Terima pada Periode');if(d.transfers.length)table(['Tanggal','Kode','Alat','Qty','Project','Penerima','Status'],d.transfers.map(r=>[fmtDateID(r.request_date),r.code,r.item_name,`${r.qty} ${r.unit}`,r.project,r.receiver,r.status]),[58,55,115,50,95,85,65],{fontSize:6.6,rowH:19});else doc.fontSize(9).fillColor(muted).text('Tidak ada pengajuan serah-terima pada periode ini.');

  // Top use & transactions
  doc.addPage();header('04  STOCK MOVEMENT');doc.y=92;section('Top 10 Alat Paling Banyak Keluar');
  if(d.topOut.length)table(['Rank','Kode','Nama Alat','Total Keluar'],d.topOut.map((x,n)=>[n+1,x.code,x.name,`${x.qty} ${x.unit}`]),[45,80,245,100],{fontSize:7.5,rowH:20});else doc.fontSize(9).fillColor(muted).text('Tidak ada transaksi OUT pada periode ini.');
  section('Detail Transaksi Bulanan');if(d.tx.length)table(['Tanggal','IN/OUT','Kode','Nama Alat','Qty','Sebelum','Sesudah','Tujuan / Sumber','PIC'],d.tx.map(t=>[fmtDateID(t.tx_date),t.tx_type,t.code,t.item_name,`${t.qty}`,t.stock_before,t.stock_after,t.source_target||'-',t.pic||'-']),[48,40,55,110,32,42,42,85,62],{fontSize:6.2,rowH:18});else doc.fontSize(9).fillColor(muted).text('Tidak ada transaksi pada periode ini.');

  // Approval page
  doc.addPage();header('05  REVIEW & APPROVAL');doc.y=104;doc.font('Helvetica-Bold').fontSize(12).fillColor(blue).text('Catatan & Tindak Lanjut');doc.moveDown(.5);doc.font('Helvetica').fontSize(9).fillColor(dark).text('1. Lakukan replenishment untuk item yang berada pada atau di bawah minimum stock.\n2. Tindak lanjuti alat berstatus Maintenance/Rusak dan dokumentasikan hasil perbaikan.\n3. Rekonsiliasi alat di project/dipinjam dengan dokumen serah-terima dan PIC.\n4. Pastikan seluruh transaksi stok memiliki nomor dokumen dan PIC yang dapat ditelusuri.',{lineGap:5});
  doc.y=330;doc.font('Helvetica-Bold').fontSize(11).fillColor(blue).text('Pengesahan Laporan');doc.y=370;const sw=(R-L-20)/3;['Prepared by\nWarehouse','Checked by\nHSE / Project','Approved by\nManagement'].forEach((t,i)=>{let x=L+i*(sw+10);doc.roundedRect(x,doc.y,sw,125,5).strokeColor('#cbd6df').stroke();doc.font('Helvetica-Bold').fontSize(8).fillColor(dark).text(t,x+8,doc.y+12,{width:sw-16,align:'center'});doc.moveTo(x+18,doc.y+92).lineTo(x+sw-18,doc.y+92).strokeColor('#9baab8').stroke();doc.font('Helvetica').fontSize(7).fillColor(muted).text('Nama / Tanggal',x+8,doc.y+98,{width:sw-16,align:'center'})});

  const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);footer(i-range.start+1)}
  doc.end();
});

app.get('/health',(req,res)=>res.json({ok:true,version:'3.0.0'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`GAJA Stock Control Pro running on ${PORT}`));
