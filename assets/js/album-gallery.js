// Album-specific gallery loader — reads data-album attribute from #flickr-gallery
// Must run BEFORE main.js so the DOM is populated when main.js initializes lightbox
(function() {
	var gallery = document.getElementById('flickr-gallery');
	if (!gallery) return;

	var albumKey = gallery.getAttribute('data-album');
	if (!albumKey) return;

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
	var album = data[albumKey];
	if (!album || !album.photos || album.photos.length === 0) {
		gallery.innerHTML = '<p style="padding: 2rem; opacity: 0.6;">No photos in this album yet. Check back soon!</p>';
		return;
	}

	var photos = album.photos;
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
