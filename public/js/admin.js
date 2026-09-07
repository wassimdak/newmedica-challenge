document.addEventListener('click', async (e) => {
  const toggleStatut = e.target.closest('.btn-toggle-statut');
  if (toggleStatut) {
    const id = toggleStatut.dataset.id;
    const res = await fetch(`/admin/preparatrices/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }

  const toggleChallenge = e.target.closest('.btn-toggle-challenge');
  if (toggleChallenge) {
    const id = toggleChallenge.dataset.id;
    const res = await fetch(`/admin/challenges/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }

  const toggleProduit = e.target.closest('.btn-toggle-produit');
  if (toggleProduit) {
    const id = toggleProduit.dataset.id;
    const res = await fetch(`/admin/produits/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }
});

// --- Recherche de pharmacie + création rapide (formulaire "Ajouter une préparatrice") ---
(function () {
  const recherche = document.getElementById('pharmacie-recherche');
  const idField = document.getElementById('pharmacie-id');
  const datalist = document.getElementById('pharmacies-datalist');
  const erreur = document.getElementById('pharmacie-erreur');
  const form = document.getElementById('form-nouvelle-preparatrice');
  const btnNouvelle = document.getElementById('btn-nouvelle-pharmacie');
  const npForm = document.getElementById('nouvelle-pharmacie-form');
  const npNom = document.getElementById('np-nom');
  const npRegion = document.getElementById('np-region');
  const btnCreer = document.getElementById('btn-creer-pharmacie');
  const npErreur = document.getElementById('np-erreur');

  if (!recherche) return; // cette page n'a pas ce formulaire (ex. rôle lecture seule)

  function idPourNom(nom) {
    const option = Array.from(datalist.options).find((o) => o.value === nom);
    return option ? option.dataset.id : '';
  }

  recherche.addEventListener('input', () => {
    idField.value = idPourNom(recherche.value);
    erreur.classList.add('hidden');
  });

  form.addEventListener('submit', (e) => {
    if (!idField.value) {
      e.preventDefault();
      erreur.classList.remove('hidden');
      recherche.focus();
    }
  });

  btnNouvelle.addEventListener('click', () => {
    npForm.classList.toggle('hidden');
    if (!npForm.classList.contains('hidden')) npNom.focus();
  });

  btnCreer.addEventListener('click', async () => {
    const nom = npNom.value.trim();
    if (!nom) {
      npErreur.textContent = 'Le nom est requis.';
      npErreur.classList.remove('hidden');
      return;
    }
    btnCreer.disabled = true;
    btnCreer.textContent = 'Création…';
    try {
      const res = await fetch('/admin/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
        body: new URLSearchParams({ nom, region_id: npRegion.value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Erreur');

      const option = document.createElement('option');
      option.value = data.nom;
      option.dataset.id = data.id;
      datalist.appendChild(option);

      recherche.value = data.nom;
      idField.value = data.id;
      erreur.classList.add('hidden');
      npForm.classList.add('hidden');
      npNom.value = '';
      npRegion.value = '';
      npErreur.classList.add('hidden');
    } catch (err) {
      npErreur.textContent = "La création a échoué. Réessayez.";
      npErreur.classList.remove('hidden');
    } finally {
      btnCreer.disabled = false;
      btnCreer.textContent = 'Créer et sélectionner';
    }
  });
})();
