const crypto=require('crypto');
const pool=require('../db');
const sessions=new Map();
const age=7*24*60*60*1000;
function cookie(header,name){const x=(header||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return x?decodeURIComponent(x.slice(name.length+1)):null;}
function setCookie(res,token){const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.setHeader('Set-Cookie',`sm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(age/1000)}${secure}`);}
function makeSession(userId=null){const token=crypto.randomBytes(32).toString('base64url'),csrfToken=crypto.randomBytes(24).toString('base64url');sessions.set(token,{userId,csrfToken,expiresAt:Date.now()+age});return{token,csrfToken};}
async function loadSession(req,res,next){try{const token=cookie(req.headers.cookie,'sm_session');let s=token&&sessions.get(token);if(s&&s.expiresAt<=Date.now()){sessions.delete(token);s=null;}req.sessionToken=s?token:null;req.session=s||null;req.user=null;if(s&&s.userId){const r=await pool.query('SELECT u.id,u.full_name,u.email,u.phone,u.role,u.is_active,ss.store_id FROM users u LEFT JOIN seller_stores ss ON ss.user_id=u.id WHERE u.id=$1',[s.userId]);if(!r.rowCount||!r.rows[0].is_active){sessions.delete(token);req.session=null;}else req.user=r.rows[0];}next();}catch(e){next(e);}}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(!req.session||req.get('x-csrf-token')!==req.session.csrfToken)return res.status(403).json({error:'Обновите страницу и повторите действие.'});next();}
function safeUser(u){return u&&{id:u.id,fullName:u.full_name,email:u.email,phone:u.phone,role:u.role,storeId:u.store_id||null};}
function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');return `pbkdf2$210000$${salt}$${crypto.pbkdf2Sync(password,salt,210000,32,'sha256').toString('hex')}`;}
function passwordMatches(password,encoded){const[,n,salt,hex]=String(encoded||'').split('$');if(!n||!salt||!hex)return false;const a=crypto.pbkdf2Sync(password,salt,Number(n),32,'sha256'),b=Buffer.from(hex,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
module.exports={sessions,age,makeSession,setCookie,loadSession,csrf,safeUser,hashPassword,passwordMatches};