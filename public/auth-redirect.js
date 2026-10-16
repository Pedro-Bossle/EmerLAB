;(function () {
  var hash = window.location.hash || ''
  var search = window.location.search || ''
  var temResposta = hash.length > 1 || /[?&](code|error|client_info|session_state)=/i.test(search)

  // Popup: o MSAL da janela pai lê o hash/query — NÃO redirecionar.
  var ehPopup = !!(window.opener && window.opener !== window)
  if (ehPopup) return

  // Redirect (janela principal): leva a resposta à SPA na Home.
  // A Home chama handleRedirectPromise (sem o Supabase a roubar o ?code=).
  if (temResposta) {
    window.location.replace('/home' + search + hash)
    return
  }
  window.location.replace('/home')
})()
