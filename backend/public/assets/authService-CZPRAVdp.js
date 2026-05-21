import{ag as e}from"./index--jJ3GfxL.js";const o={login:async(a,s)=>(await e.post("/auth/login",{username:a,password:s})).data,verifyToken:async()=>(await e.get("/auth/verify")).data};export{o as a};
