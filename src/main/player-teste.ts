// Player de demonstração: vídeo produzido localmente via canvas, sem acessos a
// transmissões externas. Permite validar um clique real de Puppeteer em um só perfil.
const HTML_TESTE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teste local de Play — Gerenciador de Perfis GPT</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101019;color:#f5f5f8;font-family:Arial,sans-serif}
header{padding:14px 20px;border-bottom:1px solid #373742;font-weight:bold}
main{max-width:850px;margin:25px auto;padding:0 18px}
#container{aspect-ratio:16/9;background:#0e0e12;position:relative;border-radius:12px;overflow:hidden}
video{display:block;width:100%;height:100%;object-fit:contain}
#botao-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:84px;height:84px;border-radius:50%;background:#fff;color:#222;border:0;font-size:36px;cursor:pointer}
#selo{position:absolute;left:16px;top:16px;background:#b91c1c;padding:6px 10px;border-radius:5px}
#estado{font-size:16px;line-height:1.5;margin-top:14px}
p{color:#b7b7c7;line-height:1.5}
</style>
</head>
<body><header>Gerenciador de Perfis GPT · Ambiente local de teste</header>
<main><div id="container"><video id="video" playsinline muted></video><div id="selo">AO VIVO · DEMO</div>
<button id="botao-play" aria-label="Iniciar vídeo de teste" title="Iniciar vídeo">▶</button></div>
<div id="estado">Player pronto. Aguardando o clique de teste…</div>
<p>O vídeo é gerado neste navegador e não acessa nenhuma live pública. 
Esta tela serve para testar o clique automático, o estado de reprodução e a detecção de travamentos.</p></main>
<script>
(() => {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const ctx=canvas.getContext('2d'),video=document.getElementById('video'),
    botao=document.getElementById('botao-play'),estado=document.getElementById('estado');
  let inicio=performance.now();
  function quadro(t){
    const s=(t-inicio)/1000;
    ctx.fillStyle='#19243a';ctx.fillRect(0,0,640,360);
    ctx.fillStyle='#60a5fa';ctx.fillRect(35+(s*70)%470,120,100,100);
    ctx.fillStyle='white';ctx.font='24px Arial';ctx.fillText('Video de teste - '+Math.floor(s)+' s',40,52);
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);
  if (!canvas.captureStream) {estado.textContent='Canvas captureStream indisponível';return;}
  video.srcObject=canvas.captureStream(12);
  video.autoplay=false;
  botao.addEventListener('click',async()=>{
    estado.textContent='Clique recebido. Iniciando vídeo…';
    try{
      await video.play();
      botao.hidden=true;
      estado.textContent='Reprodução iniciada pelo clique automático do teste.';
    }catch(e){estado.textContent='Play bloqueado: '+String(e && e.message || e);}
  });
})();
</script></body></html>`

export function urlPlayerDeTeste(): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML_TESTE)
}
