import type { Config } from 'tailwindcss';
const v=(n:string)=>`rgb(var(--${n}) / <alpha-value>)`;
export default { content:['./app/**/*.tsx','./components/**/*.tsx'],darkMode:'media',
theme:{extend:{colors:{ink:v('ink'),paper:v('paper'),card:v('card'),line:v('line'),signal:v('signal'),tint:v('tint'),ok:v('ok'),caution:v('caution'),warn:v('warn')},
borderRadius:{field:'10px',panel:'20px'},boxShadow:{soft:'0 1px 2px rgb(11 27 58/.06),0 8px 24px rgb(11 27 58/.06)'}}}} satisfies Config;
