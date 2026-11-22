/**
 * Guide du débutant & schémas vectoriels de déplacement des 6 pièces d'échecs.
 * Utilisé dans la modale d'aide (« Rappel Débutant ») et le panneau d'apprentissage.
 */

export const BEGINNER_BASICS = [
  {
    title: 'But du jeu : l’Échec et Mat',
    text: 'Protégez votre Roi et attaquez le Roi adverse. Lorsque le Roi est menacé, il est en « Échec » et doit immédiatement parer la menace. S’il ne peut ni fuir, ni bloquer, ni capturer l’attaquant, c’est « Échec et Mat » : la partie est gagnée.',
  },
  {
    title: 'Égalité (Pat & Nulle)',
    text: 'Si un joueur n’est pas en échec mais n’a aucun coup légal disponible, c’est « Pat » : la partie est déclarée nulle (égalité), même si l’un des camps possède beaucoup plus de pièces.',
  },
  {
    title: 'Les 3 règles spéciales à connaître',
    text: '1) Roque : le Roi glisse de 2 cases vers une Tour immobile qui passe de l’autre côté (si aucune case traversée n’est attaquée). 2) Promotion : un Pion arrivé au bout devient Dame, Tour, Fou ou Cavalier. 3) En passant : un Pion peut capturer un pion ennemi qui vient d’avancer de 2 cases à côté de lui.',
  },
];

export const PIECE_GUIDE_DATA = [
  {
    type: 'p',
    name: 'Le Pion (Légionnaire)',
    value: '1 point',
    badge: 'Marche avant · Prise diagonale',
    summary:
      'Le Pion avance toujours tout droit vers le camp adverse et ne recule jamais. Il capture différemment de la façon dont il se déplace.',
    moves: [
      'Avance d’1 case tout droit si la case devant lui est libre.',
      'Lors de son tout premier coup, il peut avancer de 1 ou 2 cases.',
      'Capture uniquement d’1 case en diagonale vers l’avant.',
      'Spécial : « Prise en passant » et « Promotion » sur la dernière rangée.',
    ],
  },
  {
    type: 'r',
    name: 'La Tour (Colonne)',
    value: '5 points',
    badge: 'Lignes droites illimitées',
    summary:
      'Pièce puissante à longue portée qui contrôle les colonnes verticales et les rangées horizontales.',
    moves: [
      'Se déplace horizontalement ou verticalement d’autant de cases libres que souhaité.',
      'Ne peut pas sauter par-dessus une autre pièce.',
      'Capture en prenant la place d’une pièce ennemie sur sa ligne.',
      'Spécial : participe au « Roque » avec le Roi pour le mettre à l’abri.',
    ],
  },
  {
    type: 'n',
    name: 'Le Cavalier (Cheval)',
    value: '3 points',
    badge: 'Saut en « L » par-dessus tout',
    summary:
      'La seule pièce capable de sauter par-dessus les pièces alliées ou adverses. Idéale dans les positions encombrées.',
    moves: [
      'Forme un « L » : 2 cases dans une direction (verticale ou horizontale), puis 1 case à angle droit.',
      'Passe librement au-dessus des autres pièces sur son trajet.',
      'Change toujours de couleur de case à chaque déplacement.',
      'Capture uniquement la pièce située sur sa case d’arrivée.',
    ],
  },
  {
    type: 'b',
    name: 'Le Fou (Philosophe)',
    value: '3 points',
    badge: 'Diagonales illimitées',
    summary:
      'Contrôle les grandes diagonales à distance. Chaque joueur possède un Fou sur cases claires et un Fou sur cases sombres.',
    moves: [
      'Glisse en diagonale d’autant de cases libres que souhaité.',
      'Reste toujours sur la même couleur de case durant toute la partie.',
      'Ne peut pas traverser une pièce qui bloque sa diagonale.',
      'Capture la première pièce adverse rencontrée sur sa diagonale.',
    ],
  },
  {
    type: 'q',
    name: 'La Dame (Déesse)',
    value: '9 points',
    badge: 'Toutes directions illimitées',
    summary:
      'La pièce la plus puissante de l’échiquier : elle combine les pouvoirs de la Tour et du Fou.',
    moves: [
      'Se déplace en ligne droite (avant, arrière, côtés) ou en diagonale sur autant de cases libres que voulu.',
      'Ne peut pas sauter par-dessus d’autres pièces.',
      'Capture toute pièce ennemie accessible sur ses 8 directions.',
      'Protégez-la en début de partie : évitez de la sortir trop tôt face aux pièces légères.',
    ],
  },
  {
    type: 'k',
    name: 'Le Roi (Empereur)',
    value: 'Pièce vitale',
    badge: '1 case autour · Roque',
    summary:
      'Le cœur de l’armée : s’il est mis « Échec et Mat », la partie s’arrête immédiatement.',
    moves: [
      'Se déplace d’1 seule case dans n’importe quelle direction (horizontale, verticale ou diagonale).',
      'Ne peut jamais se placer sur une case attaquée par une pièce adverse.',
      'Ne peut pas rester collé au Roi adverse.',
      'Spécial : peut effectuer le « Roque » (glisser de 2 cases vers sa Tour) une fois par partie.',
    ],
  },
];

const PIECE_SYMBOLS = {
  k: '♔',
  q: '♕',
  r: '♖',
  b: '♗',
  n: '♘',
  p: '♙',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Génère un petit schéma SVG (mini-échiquier 5×5) illustrant les déplacements
 * possibles, captures et mouvements spéciaux de la pièce demandée.
 * @param {string} pieceType
 * @returns {SVGSVGElement}
 */
export function createPieceDiagramSvg(pieceType) {
  const cell = 24;
  const size = cell * 5; // 120x120
  const svg = /** @type {SVGSVGElement} */ (
    svgEl('svg', {
      viewBox: `0 0 ${size} ${size}`,
      class: 'piece-diagram-svg',
      role: 'img',
      'aria-label': `Schéma de déplacement : ${pieceType}`,
    })
  );

  // Position de départ sur la grille 5x5 : (3,2) pour le pion, (2,2) pour les autres
  const origin = pieceType === 'p' ? { r: 3, c: 2 } : { r: 2, c: 2 };

  // 1. Damier 5×5
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isLight = (r + c) % 2 === 0;
      const isOrigin = r === origin.r && c === origin.c;
      let fill = isLight ? '#342b22' : '#1b1612';
      if (isOrigin) {
        fill = '#4a3a22';
      }
      svg.appendChild(
        svgEl('rect', {
          x: c * cell,
          y: r * cell,
          width: cell,
          height: cell,
          fill,
        })
      );
      if (isOrigin) {
        svg.appendChild(
          svgEl('rect', {
            x: c * cell + 1,
            y: r * cell + 1,
            width: cell - 2,
            height: cell - 2,
            fill: 'none',
            stroke: '#d4af37',
            'stroke-width': 1.5,
          })
        );
      }
    }
  }

  const centerOf = (r, c) => ({
    x: c * cell + cell / 2,
    y: r * cell + cell / 2,
  });

  const oc = centerOf(origin.r, origin.c);

  const addMoveDot = (r, c, dashed = false) => {
    const pt = centerOf(r, c);
    svg.appendChild(
      svgEl('circle', {
        cx: pt.x,
        cy: pt.y,
        r: dashed ? 4.4 : 4.2,
        fill: dashed ? 'rgba(212, 175, 55, 0.22)' : '#e6c665',
        stroke: '#f3e5ab',
        'stroke-width': 1.3,
        ...(dashed ? { 'stroke-dasharray': '2.2 1.8' } : {}),
      })
    );
  };

  const addCaptureRing = (r, c) => {
    const pt = centerOf(r, c);
    svg.appendChild(
      svgEl('circle', {
        cx: pt.x,
        cy: pt.y,
        r: 5.5,
        fill: 'rgba(176, 48, 66, 0.35)',
        stroke: '#f16c7e',
        'stroke-width': 1.6,
      })
    );
    svg.appendChild(
      svgEl('path', {
        d: `M${pt.x - 2.6} ${pt.y - 2.6} L${pt.x + 2.6} ${pt.y + 2.6} M${pt.x + 2.6} ${pt.y - 2.6} L${pt.x - 2.6} ${pt.y + 2.6}`,
        stroke: '#ffd7dd',
        'stroke-width': 1.4,
        'stroke-linecap': 'round',
      })
    );
  };

  const addRay = (dr, dc) => {
    let r = origin.r + dr;
    let c = origin.c + dc;
    let lastPt = oc;
    const pts = [];
    while (r >= 0 && r < 5 && c >= 0 && c < 5) {
      pts.push({ r, c });
      lastPt = centerOf(r, c);
      r += dr;
      c += dc;
    }
    if (pts.length === 0) return;

    // Trait directionnel discret derrière les points
    svg.appendChild(
      svgEl('line', {
        x1: oc.x,
        y1: oc.y,
        x2: lastPt.x,
        y2: lastPt.y,
        stroke: 'rgba(212, 175, 55, 0.55)',
        'stroke-width': 2,
        'stroke-linecap': 'round',
      })
    );

    for (const p of pts) {
      addMoveDot(p.r, p.c);
    }
  };

  // 2. Tracés selon la pièce
  if (pieceType === 'p') {
    const oneUp = centerOf(2, 2);
    const twoUp = centerOf(1, 2);
    const capLeft = centerOf(2, 1);
    const capRight = centerOf(2, 3);

    // Flèche 1 case devant
    svg.appendChild(
      svgEl('line', {
        x1: oc.x,
        y1: oc.y - 8,
        x2: oneUp.x,
        y2: oneUp.y,
        stroke: '#e6c665',
        'stroke-width': 2,
        'stroke-linecap': 'round',
      })
    );
    // Prolongation pointillée 2e case au 1er coup
    svg.appendChild(
      svgEl('line', {
        x1: oneUp.x,
        y1: oneUp.y - 4,
        x2: twoUp.x,
        y2: twoUp.y + 4,
        stroke: '#d4af37',
        'stroke-width': 1.6,
        'stroke-dasharray': '2.5 2',
      })
    );
    // Flèches de capture en diagonale
    svg.appendChild(
      svgEl('line', {
        x1: oc.x - 6,
        y1: oc.y - 6,
        x2: capLeft.x + 3,
        y2: capLeft.y + 3,
        stroke: '#f16c7e',
        'stroke-width': 1.7,
        'stroke-dasharray': '2.2 1.8',
      })
    );
    svg.appendChild(
      svgEl('line', {
        x1: oc.x + 6,
        y1: oc.y - 6,
        x2: capRight.x - 3,
        y2: capRight.y + 3,
        stroke: '#f16c7e',
        'stroke-width': 1.7,
        'stroke-dasharray': '2.2 1.8',
      })
    );

    addMoveDot(2, 2, false);
    addMoveDot(1, 2, true);
    addCaptureRing(2, 1);
    addCaptureRing(2, 3);
  } else if (pieceType === 'r') {
    addRay(-1, 0);
    addRay(1, 0);
    addRay(0, -1);
    addRay(0, 1);
  } else if (pieceType === 'b') {
    addRay(-1, -1);
    addRay(-1, 1);
    addRay(1, -1);
    addRay(1, 1);
  } else if (pieceType === 'q') {
    addRay(-1, 0);
    addRay(1, 0);
    addRay(0, -1);
    addRay(0, 1);
    addRay(-1, -1);
    addRay(-1, 1);
    addRay(1, -1);
    addRay(1, 1);
  } else if (pieceType === 'k') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const pt = centerOf(origin.r + dr, origin.c + dc);
        svg.appendChild(
          svgEl('line', {
            x1: oc.x,
            y1: oc.y,
            x2: pt.x,
            y2: pt.y,
            stroke: 'rgba(212, 175, 55, 0.5)',
            'stroke-width': 1.6,
          })
        );
        addMoveDot(origin.r + dr, origin.c + dc);
      }
    }
  } else if (pieceType === 'n') {
    const jumps = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ];
    // Tracer deux exemples de chemin en "L" pour illustrer visuellement le saut
    const lPaths = [
      { mid: centerOf(0, 2), end: centerOf(0, 1) },
      { mid: centerOf(2, 4), end: centerOf(1, 4) },
    ];
    for (const lp of lPaths) {
      svg.appendChild(
        svgEl('path', {
          d: `M${oc.x} ${oc.y} L${lp.mid.x} ${lp.mid.y} L${lp.end.x} ${lp.end.y}`,
          fill: 'none',
          stroke: 'rgba(110, 169, 151, 0.85)',
          'stroke-width': 1.7,
          'stroke-dasharray': '3 2',
          'stroke-linejoin': 'round',
        })
      );
    }
    for (const [dr, dc] of jumps) {
      addMoveDot(origin.r + dr, origin.c + dc);
    }
  }

  // 3. Symbole de la pièce sur sa case d'origine (par-dessus les traits)
  const glyph = svgEl('text', {
    x: oc.x,
    y: oc.y + 1,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill: '#FFF1BE',
    'font-size': 16,
    'font-family': 'Georgia, serif',
    'font-weight': 'bold',
  });
  glyph.textContent = PIECE_SYMBOLS[pieceType] || '♟';
  svg.appendChild(glyph);

  // Cadre extérieur doré
  svg.appendChild(
    svgEl('rect', {
      x: 0.5,
      y: 0.5,
      width: size - 1,
      height: size - 1,
      fill: 'none',
      stroke: 'rgba(212, 175, 55, 0.55)',
      'stroke-width': 1,
      rx: 4,
    })
  );

  return svg;
}
