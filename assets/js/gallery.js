// Synchronous gallery loader — must run BEFORE main.js
// Injects photos into the gallery div so main.js initializes them normally
(function() {
	var gallery = document.getElementById('flickr-gallery');
	if (!gallery) return;

	var xhr = new XMLHttpRequest();
	xhr.open('GET', 'data/photos.json', false); // synchronous
	try {
		xhr.send();
	} catch(e) {
		console.error('Could not load photos.json:', e);
		return;
	}

	if (xhr.status !== 200) {
		console.error('photos.json returned status ' + xhr.status);
		return;
	}

	var data = JSON.parse(xhr.responseText);
	var photos = data.highlights.photos;

	// Fisher-Yates shuffle
	for (var i = photos.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var tmp = photos[i];
		photos[i] = photos[j];
		photos[j] = tmp;
	}

	var html = '';

	photos.forEach(function(p) {
		var year = p.date_taken ? p.date_taken.substring(0, 4) : '';
		var caption = '';
		if (p.title && year) {
			caption = '<div class="caption"><h3>' + p.title + '</h3><p>' + year + '</p></div>';
		} else if (p.title) {
			caption = '<div class="caption"><h3>' + p.title + '</h3></div>';
		} else if (year) {
			caption = '<div class="caption"><p>' + year + '</p></div>';
		}
		html += '<article>' +
			'<a href="' + p.display_url + '" class="image">' +
				'<img src="' + p.thumb_url + '" alt="' + (p.title || '') + '" />' +
			'</a>' + caption +
			'</article>';
	});

	gallery.innerHTML = html;
})();
