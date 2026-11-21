/**
 * Tutoriel Interactif guidé pour « Échecs Antiques 3D ».
 * Met en valeur les zones clés de l'interface et accompagne le joueur
 * pas à pas dans le panneau Mode Apprentissage durant ses 3 premiers coups.
 */

export const TUTORIAL_STEPS = [
  {
    id: 'hud-status',
    badge: 'Étape 1 / 6',
    title: 'Tableau de bord & Adversaire',
    desc: 'Ce bandeau indique en temps réel à qui appartient le tour (Marbre blanc ou Bronze noir), signale les mises en échec et permet de basculer à tout moment entre l’Ordinateur et un duel à 2 Joueurs.',
    hint: 'Astuce : le bouton « Nouvelle partie » en haut à droite ouvre le menu principal.',
    kind: 'highlight',
    selector: '.hud-status-group',
    padding: 8,
  },
  {
    id: 'camera-hover',
    badge: 'Étape 2 / 6',
    title: 'Caméra 3D & Coordonnées des cases',
    desc: 'Faites glisser sur le plateau pour pivoter la caméra et pincez/zoomez. Utilisez le bouton « Vision : 3D » en bas pour alterner entre 3D, Cinématique et 2D. Survolez une case pour lire sa coordonnée directement sur le plateau.',
    hint: 'Essayez de changer la vision du plateau ou de survoler une case.',
    kind: 'highlight',
    selector: '#btn-camera-style',
    padding: 8,
  },
  {
    id: 'move-1',
    badge: 'Étape 3 / 6',
    title: 'Votre 1er coup : avancer un Pion (E2 → E4)',
    desc: 'Pour déplacer une pièce, cliquez d’abord sur votre Pion en E2 : ses cases légales s’illuminent en or (et les prises en rouge). Cliquez ensuite sur la case E4 devant lui.',
    hint: 'Suivez la flèche verte 3D (ou dites « E2 vers E4 » avec la commande vocale).',
    kind: 'move',
    moveNumber: 1,
    preferredMove: { fromRow: 6, fromCol: 4, toRow: 4, toCol: 4 },
    selector: null,
  },
  {
    id: 'move-2',
    badge: 'Étape 4 / 6',
    title: 'Développer un Cavalier (G1 → F3)',
    desc: 'En début de partie, sortez vos Cavaliers et Fous vers le centre. Le Cavalier saute par-dessus les autres pièces en forme de « L ». Cliquez sur le Cavalier en G1 puis sur F3.',
    hint: 'Lorsque vous sélectionnez une pièce, sa règle apparaît juste en dessous dans ce panneau.',
    kind: 'move',
    moveNumber: 2,
    preferredMove: { fromRow: 7, fromCol: 6, toRow: 5, toCol: 5 },
    selector: null,
  },
  {
    id: 'bottom-tools',
    badge: 'Étape 5 / 6',
    title: 'Commandes Voix, Annuler & Planche',
    desc: 'Cette barre regroupe vos outils : activez « Voix » pour jouer sans souris (« C1 vers C3 »), masquez ou ouvrez ce panneau « Apprentissage », annulez un coup, relisez l’historique ou consultez la « Planche » des 6 sculptures.',
    hint: 'Vous pouvez aussi déplacer librement ce panneau Apprentissage en le saisissant par son titre.',
    kind: 'highlight',
    selector: '.hud-bottom-actions',
    padding: 8,
  },
  {
    id: 'move-3',
    badge: 'Étape 6 / 6',
    title: 'Votre 3e coup avec le Conseil 3D',
    desc: 'À tout moment, cliquez sur « Montrer le conseil 3D » en bas de ce panneau pour afficher le meilleur coup calculé par le stratège. Jouez maintenant un 3e coup (par exemple un Fou ou un Pion) pour achever ce tutoriel.',
    hint: 'La flèche 3D vous propose un coup solide pour poursuivre l’ouverture.',
    kind: 'move',
    moveNumber: 3,
    preferredMove: null,
    selector: null,
  },
];

export const TUTORIAL_COMPLETED_STATE = {
  badge: 'Terminé ✓',
  title: 'Vous êtes prêt pour la bataille !',
  desc: 'Vous maîtrisez désormais le déplacement des pièces, les indicateurs légaux, la caméra 3D et les conseils tactiques. Le Mode Apprentissage reste actif pour évaluer chacun de vos coups.',
  hint: 'Bonne partie sur Échecs Antiques 3D !',
};
