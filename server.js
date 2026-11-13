require('dotenv').config();
const express=require('express');
const path=require('path');
const pool=require('./db');
const {loadSession,csrf}=require('./lib/auth');
const app=express();const port=Number(process.env.PORT||3000);
app.disable('x-powered-by');app.use(express.json({limit:'200kb'}));app.use(express.static(path.join(__dirname,'public')));app.use('/api',loadSession,csrf);
app.get('/api/health',async(req,res)=>{const r=await pool.query('SELECT now() server_time');res.json({status:'OK',database:'connected',serverTime:r.rows[0].server_time});});
app.use('/api',require('./routes/auth'));app.use('/api',require('./routes/catalog'));app.use('/api',require('./routes/shopper'));app.use('/api',require('./routes/customer-data'));app.use('/api',require('./routes/seller'));app.use('/api',require('./routes/admin'));
app.use('/api',(req,res)=>res.status(404).json({error:'Маршрут API не найден.'}));
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);if(error.code==='23505')return res.status(409).json({error:'Такая запись уже существует.'});if(['23503','23514','22P02'].includes(error.code))return res.status(400).json({error:'Проверьте введённые данные.'});const status=error.status||500;if(status>=500)console.error('Request failed:',error.code||error.name);res.status(status).json({error:status===500?'Внутренняя ошибка сервера.':error.message});});
async function start(){try{await pool.query('SELECT 1');app.listen(port,()=>console.log(`СтройМаркет доступен: http://localhost:${port}`));}catch(e){console.error('Не удалось подключиться к PostgreSQL:',e.code||e.name);process.exit(1);}}
if(require.main===module)start();module.exports={app,start};