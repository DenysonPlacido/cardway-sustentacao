// /workspaces/Concatenar/api/static/script.js
function mostrarAba(id) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    event.currentTarget.classList.add('active');
}

function copiarResultado(id, botao) {
    const el = document.getElementById(id);
    const texto = el.innerText;

    navigator.clipboard.writeText(texto).then(() => {
        const span = botao.querySelector(".btn-text");
        span.innerText = "Copiado!";

        setTimeout(() => {
            span.innerText = "Copiar";
        }, 2000);
    });
}

