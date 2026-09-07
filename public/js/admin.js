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
// Liste cliquable filtrée en JS plutôt qu'un <datalist> natif : le support de datalist est
// inégal sur les navigateurs mobiles (pas de menu, correspondance approximative selon les
// appareils), ce qui pouvait laisser le champ caché pharmacie_id vide à l'envoi du formulaire.
(function () {
  const recherche = document.getElementById('pharmacie-recherche');
  const idField = document.getElementById('pharmacie-id');
  const resultatsEl = document.getElementById('pharmacie-resultats');
  const dataEl = document.getElementById('pharmacies-data');
  const erreur = document.getElementById('pharmacie-erreur');
  const form = document.getElementById('form-nouvelle-preparatrice');
  const btnNouvelle = document.getElementById('btn-nouvelle-pharmacie');
  const npForm = document.getElementById('nouvelle-pharmacie-form');
  const npNom = document.getElementById('np-nom');
  const npRegion = document.getElementById('np-region');
  const btnCreer = document.getElementById('btn-creer-pharmacie');
  const npErreur = document.getElementById('np-erreur');

  if (!recherche) return; // cette page n'a pas ce formulaire (ex. rôle lecture seule)

  let pharmacies = JSON.parse(dataEl.textContent);

  function normaliser(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function afficherResultats(filtre) {
    const filtreNorm = normaliser(filtre);
    const correspondances = filtreNorm
      ? pharmacies.filter((p) => normaliser(p.nom).includes(filtreNorm))
      : pharmacies;

    if (correspondances.length === 0) {
      resultatsEl.innerHTML = '<li class="px-3 py-2 text-gray-400">Aucune pharmacie trouvée</li>';
    } else {
      resultatsEl.innerHTML = correspondances
        .slice(0, 30)
        .map((p) => `<li class="px-3 py-2 hover:bg-nm-bg cursor-pointer" data-id="${p.id}" data-nom="${p.nom.replace(/"/g, '&quot;')}">${p.nom}</li>`)
        .join('');
    }
    resultatsEl.classList.remove('hidden');
  }

  function selectionner(id, nom) {
    idField.value = id;
    recherche.value = nom;
    resultatsEl.classList.add('hidden');
    erreur.classList.add('hidden');
  }

  recherche.addEventListener('focus', () => afficherResultats(recherche.value));
  recherche.addEventListener('input', () => {
    idField.value = ''; // toute frappe invalide la sélection précédente tant qu'on ne re-clique pas
    afficherResultats(recherche.value);
  });

  resultatsEl.addEventListener('mousedown', (e) => {
    // mousedown (pas click) pour s'exécuter avant le blur du champ de recherche
    const li = e.target.closest('li[data-id]');
    if (li) selectionner(li.dataset.id, li.dataset.nom);
  });

  document.addEventListener('click', (e) => {
    if (!resultatsEl.contains(e.target) && e.target !== recherche) resultatsEl.classList.add('hidden');
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

      pharmacies.push({ id: data.id, nom: data.nom });
      selectionner(data.id, data.nom);
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
