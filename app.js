'use strict';
/* ================== Utilitários (testáveis) ================== */
function brl(v){return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');}
function soDigitos(s){return String(s||'').replace(/\D/g,'');}
function cpfValido(c){
  c = soDigitos(c);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (var t=9;t<11;t++){var s=0;for(var i=0;i<t;i++)s+=Number(c[i])*(t+1-i);if(((s*10)%11)%10!==Number(c[t]))return false;}
  return true;
}
function mascaraCPF(v){v=soDigitos(v).slice(0,11);return v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');}
function mascaraTel(v){v=soDigitos(v).slice(0,11);if(v.length<=10)return v.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{4})(\d)/,'$1-$2');return v.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2');}
function semAcento(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9 ]/g,'').trim();}
function crc16(s){var crc=0xFFFF;for(var i=0;i<s.length;i++){crc^=s.charCodeAt(i)<<8;for(var j=0;j<8;j++){crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);crc&=0xFFFF;}}return crc.toString(16).toUpperCase().padStart(4,'0');}
function nomePix(n){var p=semAcento(n).toUpperCase().split(/\s+/).filter(Boolean);for(var i=p.length-2;i>0&&p.join(' ').length>25;i--)p[i]=p[i][0];return p.join(' ').slice(0,25);}
function tlv(id,v){v=String(v);return id+String(v.length).padStart(2,'0')+v;}
/** Gera o "Pix Copia e Cola" (BR Code estático, padrão Banco Central). */
function pixPayload(chave,nome,cidade,valor,descricao,txid){
  var conta = tlv('00','br.gov.bcb.pix') + tlv('01',chave) + (descricao ? tlv('02',semAcento(descricao).slice(0,40)) : '');
  var p = tlv('00','01') + tlv('26',conta) + tlv('52','0000') + tlv('53','986') +
          (valor ? tlv('54',Number(valor).toFixed(2)) : '') + tlv('58','BR') +
          tlv('59',nomePix(nome) || 'BOLAO') +
          tlv('60',semAcento(cidade).toUpperCase().slice(0,15) || 'BRASIL') +
          tlv('62',tlv('05',txid||'***')) + '6304';
  return p + crc16(p);
}

/* ================== Estado ================== */
/* Rascunho: guarda o que a pessoa preencheu NO PRÓPRIO CELULAR (por até 24h),
   para não perder nada quando ela sai para o app do banco e a página recarrega.
   É apagado assim que a inscrição é concluída. */
var CHAVE_RASCUNHO = 'bolao26_rascunho', CAMPOS = ['nome','cpf','whatsapp','titular','txid'];
var concluido = false;
function salvarRascunho(){
  if(concluido) return;
  try{ var r={t:Date.now(),qtd:qtd}; CAMPOS.forEach(function(c){ r[c]=$(c).value; });
       localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r)); }catch(e){}
}
function lerRascunho(){
  try{ var r=JSON.parse(localStorage.getItem(CHAVE_RASCUNHO)||'null');
       return (r && Date.now()-r.t < 86400000) ? r : null; }catch(e){ return null; }
}
function limparRascunho(){ try{ localStorage.removeItem(CHAVE_RASCUNHO); }catch(e){} }

var CFG = null, qtd = 1, arquivoSel = null, idem = gerarId(), enviando = false;
function gerarId(){return 'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
function $(id){return document.getElementById(id);}
function toast(t){var el=$('toast');el.textContent=t;el.classList.add('on');setTimeout(function(){el.classList.remove('on');},2200);}

/* ================== Backend: API no Google Apps Script ================== */
var API = 'https://script.google.com/macros/s/AKfycbw-C9adu847BA51TwpYIC_ReftN-THfFZiIh_9WrRV4cNHcGIK22B5hJeHwLWU4AQv83w/exec';
function chamar(fn,arg){
  // credentials:'omit' = nenhum cookie/conta Google é enviado (evita o erro de várias contas e protege a privacidade)
  return fetch(API,{method:'POST',credentials:'omit',redirect:'follow',cache:'no-store',
      body:JSON.stringify({acao:fn,dados:arg||null})})
    .then(function(r){ if(!r.ok) throw new Error('Falha de conexão ('+r.status+').'); return r.json(); })
    .then(function(j){ if(!j || !j.ok) throw new Error((j&&j.erro)||'Erro desconhecido.'); return j.resultado; });
}

/* ================== Inicialização ================== */
chamar('getDadosPublicos').then(function(c){
  CFG = c;
  document.querySelectorAll('.js-valor').forEach(function(el){el.textContent = el.closest('.kpi') ? 'R$ '+Math.round(c.valorCota) : brl(c.valorCota);});
  $('kpiCotas').textContent = c.cotasConfirmadas;
  c.vagas = Math.max(0,(c.limiteTotal||100)-(c.cotasReservadas||0));
  $('kpiVagas').textContent = c.vagas;
  if(c.vagas<=0 && !c.encerrado) esgotar();
  $('chaveTxt').textContent = c.pixChaveExibicao;
  $('titularTxt').innerHTML = 'Titular: <b>'+esc(c.pixTitular)+'</b>'+(c.pixBanco?' · '+esc(c.pixBanco):'')+(c.pixTipo==='telefone'?' · chave celular':'');
  $('titularConf').textContent = c.pixTitular;
  if(!c.pixConfigurado) $('avisoConfig').classList.remove('hide');
  if(c.encerrado) encerrar();
  if(c.linkGrupo){ $('zapGrupo').href=c.linkGrupo; $('zapGrupo').classList.remove('hide'); }
  var r = lerRascunho();
  if(r){
    qtd = parseInt(r.qtd,10) || 1;
    CAMPOS.forEach(function(c){ if(r[c]) $(c).value = r[c]; });
    if((r.nome || r.qtd>1) && $('avisoRascunho')){ $('avisoRascunho').classList.remove('hide'); }
  }
  atualizar(); contagem(); setInterval(contagem,1000);
}).catch(function(e){ mostrarErro('Não consegui carregar os dados do bolão. Recarregue a página. ('+e.message+')'); });

function esc(s){return String(s||'').replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];});}

function encerrar(){ $('encerrado').classList.remove('hide'); $('form').classList.add('hide'); $('ctaTopo').textContent='Adesões encerradas'; $('contagemBox').classList.add('hide'); }

function esgotar(){ var el=$('encerrado'); el.innerHTML='🎟️ <b>Bolão esgotado:</b> as '+(CFG.limiteTotal||100)+' cotas já foram reservadas. Se alguém desistir, a vaga volta a aparecer aqui.'; el.classList.remove('hide'); $('form').classList.add('hide'); $('ctaTopo').textContent='Cotas esgotadas'; }

function contagem(){
  if(!CFG) return;
  var ms = new Date(CFG.prazoISO) - new Date();
  if(ms<=0){ encerrar(); return; }
  var s=Math.floor(ms/1000);
  $('cd-d').textContent=Math.floor(s/86400); $('cd-h').textContent=String(Math.floor(s%86400/3600)).padStart(2,'0');
  $('cd-m').textContent=String(Math.floor(s%3600/60)).padStart(2,'0'); $('cd-s').textContent=String(s%60).padStart(2,'0');
}

function payloadAtual(){
  return pixPayload(CFG.pixChave, CFG.pixTitular, CFG.pixCidade, qtd*CFG.valorCota, 'Bolao Mega 2026 '+qtd+' cota'+(qtd>1?'s':''));
}

function atualizar(){
  if(!CFG) return;
  var max = Math.max(1, Math.min(CFG.maxCotas||20, CFG.vagas==null?99:CFG.vagas));
  qtd = Math.max(1, Math.min(max, qtd));
  $('qtd').textContent = qtd;
  $('formula').textContent = qtd+' × '+brl(CFG.valorCota);
  $('valorTotal').textContent = brl(qtd*CFG.valorCota);
  if($('valorPix')) $('valorPix').textContent = brl(qtd*CFG.valorCota);
  if($('barraTotal')) $('barraTotal').textContent = qtd+' cota'+(qtd>1?'s':'')+' · '+brl(qtd*CFG.valorCota);
  document.querySelectorAll('#atalhos button').forEach(function(b){ var q=+b.dataset.q; b.classList.toggle('on',q===qtd); b.disabled = q>max; });
  var txt = qtd+' cota'+(qtd>1?'s':'')+' · '+brl(qtd*CFG.valorCota);
  if(!enviando) $('enviar').textContent = 'Confirmar inscrição: '+txt;
  if($('confValor')) $('confValor').innerHTML = '🔎 Confira: o comprovante deve ser de <b>'+brl(qtd*CFG.valorCota)+'</b> ('+qtd+' cota'+(qtd>1?'s':'')+'). Se pagou outro valor, ajuste a quantidade de cotas no passo 2.';
  salvarRascunho();
  $('menos').disabled = qtd<=1; $('mais').disabled = qtd>=max;
  try{
    var q = qrcode(0,'M'); q.addData(payloadAtual()); q.make();
    $('qr').innerHTML = q.createSvgTag({cellSize:4,margin:2,scalable:true});
  }catch(e){ $('qr').innerHTML='<small style="color:var(--cinza)">Use o Copia e Cola ao lado</small>'; }
}

$('menos').onclick=function(){qtd--;atualizar();};
$('mais').onclick=function(){qtd++;atualizar();};

function copiar(txt,msg){
  var fim=function(){toast(msg);};
  if(navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(txt).then(fim,function(){copiarFallback(txt);fim();}); }
  else { copiarFallback(txt); fim(); }
}
function copiarFallback(txt){var t=document.createElement('textarea');t.value=txt;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(t);}
$('copiarCola').onclick=function(){ copiar(payloadAtual(),'Pix Copia e Cola copiado ✓ ('+brl(qtd*CFG.valorCota)+')'); };
$('copiarChave').onclick=function(){ copiar(CFG.pixChaveExibicao,'Chave Pix copiada ✓'); };

/* máscaras */
$('cpf').addEventListener('input',function(){this.value=mascaraCPF(this.value);});
$('whatsapp').addEventListener('input',function(){this.value=mascaraTel(this.value);});

/* upload */
$('arquivo').addEventListener('change',function(){
  var f=this.files[0]; arquivoSel=null;
  if(!f){ $('uploadBox').classList.remove('ok'); return; }
  var lim=(CFG?CFG.maxArquivoMB:8)*1024*1024;
  if(f.size>lim){ erroCampo('comprovante','Arquivo acima de '+(lim/1048576)+' MB. Envie um print menor.'); this.value=''; return; }
  if(!/^image\/|application\/pdf/.test(f.type)){ erroCampo('comprovante','Envie imagem ou PDF.'); this.value=''; return; }
  arquivoSel=f; erroCampo('comprovante','');
  $('uploadBox').classList.add('ok');
  $('uploadTxt').innerHTML='✅ <b>'+esc(f.name)+'</b><br><small style="color:var(--cinza)">Toque para trocar</small>';
});

function erroCampo(campo,msg){
  var el=document.querySelector('.msg-campo[data-for="'+campo+'"]'); if(el) el.textContent=msg;
  var inp=$(campo); if(inp && inp.tagName==='INPUT') inp.classList.toggle('invalido',!!msg);
}
function mostrarErro(msg){ var el=$('erroGeral'); el.textContent=msg; el.classList.toggle('hide',!msg); }

function validar(){
  var ok=true;
  var nome=$('nome').value.trim();
  if(nome.split(/\s+/).length<2){erroCampo('nome','Digite nome e sobrenome.');ok=false;} else erroCampo('nome','');
  if(!cpfValido($('cpf').value)){erroCampo('cpf','CPF inválido. Confira os números.');ok=false;} else erroCampo('cpf','');
  var z=soDigitos($('whatsapp').value);
  if(z.length<10||z.length>11){erroCampo('whatsapp','Informe DDD + número.');ok=false;} else erroCampo('whatsapp','');
  if(!arquivoSel && $('txid').value.trim().length<6){erroCampo('comprovante','Anexe o comprovante ou informe o ID da transação.');ok=false;} else erroCampo('comprovante','');
  if(!$('aceite').checked){erroCampo('aceite','Marque para confirmar que leu as regras.');ok=false;} else erroCampo('aceite','');
  if(!ok){ var p=document.querySelector('.msg-campo:not(:empty)'); if(p) p.scrollIntoView({behavior:'smooth',block:'center'}); }
  return ok;
}

function lerArquivo(f){
  return new Promise(function(ok,falha){
    if(!f) return ok(null);
    var r=new FileReader();
    r.onload=function(){ ok({nome:f.name, mime:f.type, base64:String(r.result).split(',')[1]}); };
    r.onerror=function(){ falha(new Error('Não consegui ler o arquivo.')); };
    r.readAsDataURL(f);
  });
}

$('form').addEventListener('submit',function(ev){
  ev.preventDefault();
  if(enviando) return;
  mostrarErro('');
  if(!validar()) return;
  enviando=true;
  var btn=$('enviar'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Enviando…';
  lerArquivo(arquivoSel).then(function(arq){
    return chamar('registrarInscricao',{
      idem:idem, nome:$('nome').value.trim(), titular:$('titular').value.trim(),
      cpf:$('cpf').value, whatsapp:$('whatsapp').value, cotas:qtd,
      txid:$('txid').value.trim(), consentimento:$('aceite').checked, arquivo:arq, site:$('site').value
    });
  }).then(function(r){
    concluido = true; limparRascunho();
    $('form').classList.add('hide'); $('sucesso').classList.remove('hide');
    $('protocoloTxt').textContent=r.protocolo;
    $('resumoTxt').innerHTML='<b>'+r.cotas+' cota'+(r.cotas>1?'s':'')+'</b> · '+brl(r.valor);
    var msg='Oi! Fiz minha inscrição no Bolão da Mega da Virada 2026 🍀\nProtocolo: '+r.protocolo+'\nNome: '+$('nome').value.trim()+'\nCotas: '+r.cotas+' ('+brl(r.valor)+')';
    $('zapOrg').href='https://wa.me/'+CFG.organizadorWhatsapp+'?text='+encodeURIComponent(msg);
    $('sucesso').scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(function(e){
    mostrarErro('⚠️ '+(e.message||e)+' Tente de novo; se persistir, chame a organização no WhatsApp.');
  }).then(function(){ enviando=false; btn.disabled=false; atualizar(); });
});

$('novaInscricao').onclick=function(){
  idem=gerarId(); arquivoSel=null; concluido=false; $('form').reset(); qtd=1; limparRascunho(); $('avisoRascunho').classList.add('hide'); atualizar();
  $('uploadBox').classList.remove('ok'); $('uploadTxt').innerHTML='📎 <b>Toque para anexar o comprovante</b><br><small style="color:var(--cinza)">Print ou PDF, até 8 MB</small>';
  $('sucesso').classList.add('hide'); $('form').classList.remove('hide');
  $('form').scrollIntoView({behavior:'smooth'});
};

$('ctaTopo').onclick=function(){ $('inscricao').scrollIntoView({behavior:'smooth'}); };

CAMPOS.forEach(function(c){ $(c).addEventListener('input', salvarRascunho); });
$('limparRascunho').onclick=function(){ limparRascunho(); $('form').reset(); qtd=1; $('avisoRascunho').classList.add('hide'); atualizar(); };

document.querySelectorAll('#atalhos button').forEach(function(b){ b.onclick=function(){ qtd=+b.dataset.q; atualizar(); }; });
(function(){
  var barra=$('barra'); if(!barra||!('IntersectionObserver' in window)) return;
  var visForm=false, visHero=true;
  function upd(){ var on = !visForm && !visHero && !$('form').classList.contains('hide'); barra.classList.toggle('on',on); }
  new IntersectionObserver(function(e){ visForm=e[0].isIntersecting; upd(); }).observe($('inscricao'));
  new IntersectionObserver(function(e){ visHero=e[0].isIntersecting; upd(); }).observe(document.querySelector('.hero'));
  $('barraBtn').onclick=function(){ $('inscricao').scrollIntoView({behavior:'smooth'}); };
})();
