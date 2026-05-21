(function() {
	var STORAGE_KEY = 'theme-preference';

	function getPreference() {
		var stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return stored;
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function applyTheme(theme) {
		var body = document.body;
		var toggle = document.getElementById('dark-mode-toggle');
		if (theme === 'dark') {
			body.classList.add('dark-mode');
			if (toggle) toggle.setAttribute('aria-label', 'Switch to light mode');
		} else {
			body.classList.remove('dark-mode');
			if (toggle) toggle.setAttribute('aria-label', 'Switch to dark mode');
		}
		updateIcon(theme);
	}

	function updateIcon(theme) {
		var sunIcon = document.querySelector('.dm-toggle-sun');
		var moonIcon = document.querySelector('.dm-toggle-moon');
		if (!sunIcon || !moonIcon) return;
		if (theme === 'dark') {
			sunIcon.style.display = 'block';
			moonIcon.style.display = 'none';
		} else {
			sunIcon.style.display = 'none';
			moonIcon.style.display = 'block';
		}
	}

	function toggleTheme() {
		var current = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
		var next = current === 'dark' ? 'light' : 'dark';
		localStorage.setItem(STORAGE_KEY, next);
		applyTheme(next);
	}

	var theme = getPreference();
	if (theme === 'dark') {
		document.documentElement.classList.add('dark-mode-preload');
	}

	document.addEventListener('DOMContentLoaded', function() {
		document.documentElement.classList.remove('dark-mode-preload');
		applyTheme(getPreference());
		var toggle = document.getElementById('dark-mode-toggle');
		if (toggle) toggle.addEventListener('click', toggleTheme);
	});
})();
