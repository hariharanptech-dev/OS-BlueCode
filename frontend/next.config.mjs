/** @type {import('next').NextConfig} */
export default { async rewrites(){ const b=process.env.BACKEND_URL; return b?[{source:'/api/v1/:p*',destination:`${b}/api/v1/:p*`}]:[]; } };
