(function () {
  'use strict';

  var STORAGE_KEY = 'mmup-site-language';
  var language = (document.documentElement.lang || '').split('-')[0].toLowerCase();
  var options = document.querySelectorAll('[data-language-option]');

  if (!options.length) {
    return;
  }

  options.forEach(function (option) {
    var isCurrent = option.dataset.languageOption === language;

    if (isCurrent) {
      option.setAttribute('aria-current', 'true');
    } else {
      option.removeAttribute('aria-current');
    }

    option.addEventListener('click', function () {
      var selectedLanguage = option.dataset.languageOption;

      if (!selectedLanguage) {
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEY, selectedLanguage);
      } catch {
        // El almacenamiento puede estar bloqueado; el enlace sigue navegando.
      }

      // No se cancela el clic: el href del enlace realiza la navegación.
    });
  });
})();
