export const makomStyle = `
.makom-form { display:grid; gap:14px; max-width:680px; color:inherit; font:inherit; }
.makom-form p { margin:0; line-height:1.7; }
.makom-form label { display:grid; gap:6px; }
.makom-form input[type=url] { width:100%; box-sizing:border-box; padding:10px; border:1px solid #a6b5b7; border-radius:8px; color:inherit; background:transparent; font:inherit; }
.makom-form fieldset { min-width:0; display:grid; gap:10px; padding:12px; border:1px solid #a6b5b7; border-radius:10px; }
.makom-form .makom-profile { display:flex; align-items:center; gap:10px; }
.makom-form .makom-profile input { width:18px; height:18px; flex:0 0 auto; }
.makom-form button { font:inherit; padding:9px 14px; border:1px solid #a6b5b7; border-radius:8px; color:inherit; background:transparent; cursor:pointer; }
.makom-form button.primary-button { background:#006b70; color:white; border-color:#006b70; }
.makom-form button:disabled { opacity:.5; cursor:default; }
.makom-form .modal__actions { display:flex; flex-wrap:wrap; gap:10px; }
.makom-form .form-error { color:#c74545; }
`
