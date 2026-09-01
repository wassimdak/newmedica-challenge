(function () {
  const MARQUES = JSON.parse(document.getElementById('marques-data').textContent);

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  const captureZone = document.getElementById('capture-zone');
  const photoInput = document.getElementById('photo-input');
  const previewZone = document.getElementById('preview-zone');
  const previewImg = document.getElementById('preview-img');
  const analyseStatus = document.getElementById('analyse-status');
  const analyseStatusText = document.getElementById('analyse-status-text');
  const lignesZone = document.getElementById('lignes-zone');
  const lignesList = document.getElementById('lignes-list');
  const btnAjouterLigne = document.getElementById('btn-ajouter-ligne');
  const btnEnvoyer = document.getElementById('btn-envoyer');

  let currentPhoto = null;
  let currentOcrText = '';

  captureZone.addEventListener('click', () => photoInput.click());

  function ligneOptions(selectedMarqueId) {
    return MARQUES.map(
      (m) => `<option value="${m.id}" ${m.id === selectedMarqueId ? 'selected' : ''}>${m.nom}</option>`
    ).join('');
  }

  function addLigneRow(marqueId, quantite) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <select class="ligne-marque flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm">${ligneOptions(marqueId)}</select>
      <input type="number" min="1" max="99" value="${quantite || 1}" class="ligne-quantite w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center" />
      <button type="button" class="btn-remove-ligne text-gray-400 text-lg px-1" aria-label="Retirer">✕</button>
    `;
    row.querySelector('.btn-remove-ligne').addEventListener('click', () => row.remove());
    lignesList.appendChild(row);
  }

  btnAjouterLigne.addEventListener('click', () => addLigneRow(MARQUES[0] && MARQUES[0].id, 1));

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    previewImg.src = URL.createObjectURL(file);
    previewZone.classList.remove('hidden');
    captureZone.classList.add('hidden');
    analyseStatus.classList.remove('hidden');
    analyseStatusText.textContent = 'Analyse du ticket en cours… (peut prendre jusqu\'à 30 secondes)';
    lignesZone.classList.add('hidden');
    lignesList.innerHTML = '';

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const res = await fetch('/scanner/analyser', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "L'analyse a échoué");
        currentPhoto = data.photo || null;
        currentOcrText = '';
      } else {
        currentPhoto = data.photo;
        currentOcrText = data.ocrText || '';
        if (data.suggestions.length === 0) {
          showToast('Aucun produit détecté automatiquement — ajoute les lignes manuellement.');
        }
        data.suggestions.forEach((s) => addLigneRow(s.marque_id, s.quantite));
      }
    } catch (err) {
      showToast('Erreur réseau pendant l\'analyse');
    } finally {
      analyseStatus.classList.add('hidden');
      if (lignesList.children.length === 0) addLigneRow(MARQUES[0] && MARQUES[0].id, 1);
      lignesZone.classList.remove('hidden');
    }
  });

  btnEnvoyer.addEventListener('click', async () => {
    if (!currentPhoto) {
      showToast('Prends une photo du ticket avant d\'envoyer.');
      return;
    }
    const lignes = Array.from(lignesList.children).map((row) => ({
      marque_id: row.querySelector('.ligne-marque').value,
      quantite: parseInt(row.querySelector('.ligne-quantite').value, 10) || 0,
    }));

    btnEnvoyer.disabled = true;
    btnEnvoyer.textContent = 'Envoi…';
    try {
      const res = await fetch('/scanner/confirmer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: currentPhoto, ocrText: currentOcrText, lignes }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "L'envoi a échoué");
        btnEnvoyer.disabled = false;
        btnEnvoyer.textContent = 'Envoyer pour validation';
        return;
      }
      showToast('Ticket envoyé — en attente de validation NewMedica.');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast('Erreur réseau pendant l\'envoi');
      btnEnvoyer.disabled = false;
      btnEnvoyer.textContent = 'Envoyer pour validation';
    }
  });
})();
