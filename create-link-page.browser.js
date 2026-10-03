(() => {
  const config = window.CREATE_LINK_PAGE_INFO || {};
  const event1 = config.event1 || 'Ngày 1';
  const event2 = config.event2 || 'Ngày 2';

  document.title = 'Tạo link thiệp cưới';
  document.head.insertAdjacentHTML('beforeend', `<style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #31251f; background: #fcf8f4; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #f8e8dd, #fcf8f4 48%); }
    main { width: min(100%, 620px); padding: 32px; border: 1px solid #ead9cc; border-radius: 20px; background: rgba(255, 255, 255, .94); box-shadow: 0 18px 48px rgba(86, 52, 34, .12); }
    h1 { margin: 0; color: #8f3d3d; font-family: Georgia, serif; font-size: clamp(28px, 6vw, 38px); text-align: center; }
    .intro { margin: 10px 0 28px; color: #735d50; line-height: 1.55; text-align: center; }
    label, legend { display: block; margin-bottom: 9px; color: #4d382e; font-weight: 700; }
    input[type="text"], #result { width: 100%; min-height: 48px; border: 1px solid #d8c2b1; border-radius: 10px; padding: 12px 14px; color: #30221b; font: inherit; }
    input[type="text"]:focus { border-color: #9b4c47; outline: 3px solid rgba(155, 76, 71, .16); }
    fieldset { margin: 22px 0 0; padding: 0; border: 0; }
    .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .option { display: flex; min-height: 48px; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid #decabb; border-radius: 10px; cursor: pointer; }
    .option:has(input:checked) { border-color: #9b4c47; background: #fdf0ed; }
    .option input { accent-color: #9b4c47; }
    .result-label { margin-top: 28px; }
    #result { display: block; resize: vertical; min-height: 88px; background: #fffdfb; line-height: 1.5; }
    .actions { display: flex; gap: 10px; margin-top: 12px; }
    button { min-height: 46px; border: 0; border-radius: 10px; padding: 0 18px; color: #fff; background: #9b4c47; cursor: pointer; font: 700 16px/1 Arial, sans-serif; }
    button:hover { background: #803b37; }
    #copy-status { min-height: 20px; margin: 10px 0 0; color: #31734a; font-size: 14px; }
    @media (max-width: 460px) { body { padding: 14px; } main { padding: 24px 18px; } .options { grid-template-columns: 1fr; } }
  </style>`);

  document.body.innerHTML = `
    <main>
      <h1>Tạo link thiệp cưới</h1>
      <p class="intro">Nhập thông tin khách mời để tạo link gửi thiệp riêng.</p>
      <label for="guest-name">Tên khách mời</label>
      <input id="guest-name" type="text" autocomplete="name" placeholder="Ví dụ: Bạn Đức">
      <fieldset><legend>Chọn ngày</legend><div class="options">
        <label class="option"><input type="radio" name="ngay" value="1"> <span data-event="1"></span></label>
        <label class="option"><input type="radio" name="ngay" value="2" checked> <span data-event="2"></span></label>
      </div></fieldset>
      <fieldset><legend>Chọn địa chỉ</legend><div class="options">
        <label class="option"><input type="radio" name="addr" value="re" checked> Tại nhà trai</label>
        <label class="option"><input type="radio" name="addr" value="dau"> Tại nhà gái</label>
      </div></fieldset>
      <label class="result-label" for="result">Link gửi khách</label>
      <textarea id="result" readonly aria-label="Link thiệp cưới đã tạo"></textarea>
      <div class="actions"><button id="copy" type="button">Sao chép link</button></div>
      <p id="copy-status" aria-live="polite"></p>
    </main>`;

  document.querySelector('[data-event="1"]').textContent = event1;
  document.querySelector('[data-event="2"]').textContent = event2;

  const nameInput = document.getElementById('guest-name');
  const result = document.getElementById('result');
  const status = document.getElementById('copy-status');
  const selected = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const invitationUrl = new URL('../', window.location.href);
  invitationUrl.search = '';
  invitationUrl.hash = '';

  const update = () => {
    result.value = invitationUrl.href + '?name=' + encodeURIComponent(nameInput.value.trim())
      + '&&ngay=' + selected('ngay') + '&&addr=' + selected('addr');
    status.textContent = '';
  };

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(result.value);
      else { result.select(); document.execCommand('copy'); }
      status.textContent = 'Đã sao chép link.';
    } catch {
      result.focus();
      result.select();
      status.textContent = 'Hãy sao chép link đang được bôi chọn.';
    }
  };

  nameInput.addEventListener('input', update);
  document.querySelectorAll('input[type="radio"]').forEach((input) => input.addEventListener('change', update));
  document.getElementById('copy').addEventListener('click', copy);
  update();
})();
