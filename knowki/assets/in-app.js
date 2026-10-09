// Opened from the KnowKi iOS app (?from=app on its links): hide donation and affiliate sections, so the app never leads
// to a payment page (App Store guideline 3.1.1). Remembered for the visit, so links between these pages stay clean.
(function(){try{var q=new URLSearchParams(location.search).get('from')==='app';if(q)sessionStorage.setItem('knowkiInApp','1');
if(q||sessionStorage.getItem('knowkiInApp')==='1')document.documentElement.classList.add('in-app');}catch(e){if(/[?&]from=app\b/.test(location.search))document.documentElement.classList.add('in-app');}})();
