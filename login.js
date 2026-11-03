import {db,el,message} from './api.js';
const {data:{user}}=await db.auth.getUser();if(user)location.href='home.html';
el('login').addEventListener('submit',async e=>{e.preventDefault();const email=el('email').value.trim(),password=el('password').value;const {error}=await db.auth.signInWithPassword({email,password});if(error)message('Login failed. Check credentials.',true);else location.href='home.html';});
