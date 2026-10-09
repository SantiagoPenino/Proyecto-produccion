// =====================================================================
// Dibujos de prendas para la tienda del portal (vista de frente, "dibujo plano").
// Dibujados para USER el 09/10/2026: son propios, sin licencia de terceros.
//
// Todas comparten el mismo trazo, en un lienzo de 240×240, con estas clases:
//   cuerpo   → la tela (color de la prenda) con su contorno
//   hueco    → el interior que se ve (espalda por el cuello, adentro de la capucha)
//   costura  → costuras marcadas (sisa, pretina, puños)
//   pespunte → pespuntes punteados (ruedos, bolsillos, bragueta)
//   rib      → las rayitas del tejido acanalado (puños, cintura, cuellos)
//   metal    → botones, ojales metálicos, cierre
//   cierre   → los dientes de un cierre
// El color se aplica al generar (generar.cjs): acá no hay colores.
// =====================================================================

const PRENDAS = [
    {
        id: 'remera', nombre: 'Remera',
        svg: `
  <path class="cuerpo" d="M95 30 L66 40 C 52 46, 38 62, 30 78 L50 100 C 58 94, 64 90, 70 86 C 70 130, 72 170, 72 206 Q 120 210 168 206 C 168 170, 170 130, 170 86 C 176 90, 182 94, 190 100 L210 78 C 202 62, 188 46, 174 40 L145 30 C 138 48, 102 48, 95 30 Z"/>
  <path class="hueco" d="M95 30 C 104 36, 136 36, 145 30 C 138 48, 102 48, 95 30 Z"/>
  <path class="costura" d="M90 32 C 97 58, 143 58, 150 32"/>
  <path class="costura" d="M66 40 C 72 56, 72 72, 70 86"/>
  <path class="costura" d="M174 40 C 168 56, 168 72, 170 86"/>
  <path class="pespunte" d="M35 73 L54 95"/>
  <path class="pespunte" d="M205 73 L186 95"/>
  <path class="pespunte" d="M73 200 Q 120 204 167 200"/>`,
    },
    {
        id: 'musculosa', nombre: 'Musculosa',
        svg: `
  <path class="cuerpo" d="M86 24 L100 24 C 106 54, 134 54, 140 24 L154 24 C 156 60, 164 84, 174 98 C 172 140, 172 176, 172 206 Q 120 210 68 206 C 68 176, 68 140, 66 98 C 76 84, 84 60, 86 24 Z"/>
  <path class="hueco" d="M100 24 C 108 33, 132 33, 140 24 C 134 54, 106 54, 100 24 Z"/>
  <path class="pespunte" d="M104 27 C 110 49, 130 49, 136 27"/>
  <path class="pespunte" d="M90 27 C 88 60, 81 82, 71 96"/>
  <path class="pespunte" d="M150 27 C 152 60, 159 82, 169 96"/>
  <path class="pespunte" d="M69 200 Q 120 204 171 200"/>`,
    },
    {
        id: 'camisa', nombre: 'Camisa',
        svg: `
  <path class="cuerpo" d="M92 34 L64 44 C 50 60, 40 110, 36 168 L34 190 L54 190 L55 170 C 57 136, 64 112, 72 96 L72 200 Q 96 216 120 212 Q 144 216 168 200 L168 96 C 176 112, 183 136, 185 170 L186 190 L206 190 L204 168 C 200 110, 190 60, 176 44 L148 34 Z"/>
  <path class="costura" d="M64 44 C 70 62, 72 80, 72 96"/>
  <path class="costura" d="M176 44 C 170 62, 168 80, 168 96"/>
  <path class="costura" d="M35.7 172 L55 172"/>
  <path class="costura" d="M185 172 L204.3 172"/>
  <circle class="metal" cx="45" cy="181" r="2.2"/>
  <circle class="metal" cx="195" cy="181" r="2.2"/>
  <!-- tapeta y botones -->
  <path class="costura" d="M115 50 V212"/>
  <path class="costura" d="M125 50 V212"/>
  <circle class="metal" cx="120" cy="68" r="2.6"/>
  <circle class="metal" cx="120" cy="96" r="2.6"/>
  <circle class="metal" cx="120" cy="124" r="2.6"/>
  <circle class="metal" cx="120" cy="152" r="2.6"/>
  <circle class="metal" cx="120" cy="180" r="2.6"/>
  <!-- bolsillo -->
  <path class="cuerpo" d="M134 78 L156 78 L156 100 L145 105 L134 100 Z"/>
  <path class="pespunte" d="M134 82 L156 82"/>
  <!-- cuello -->
  <path class="hueco" d="M95 28 C 104 22, 136 22, 145 28 L120 48 Z"/>
  <path class="cuerpo" d="M95 28 L120 48 L105 60 L89 38 Z"/>
  <path class="cuerpo" d="M145 28 L120 48 L135 60 L151 38 Z"/>`,
    },
    {
        id: 'buzo', nombre: 'Buzo con capucha',
        svg: `
  <path class="cuerpo" d="M86 48 L62 56 C 46 70, 36 120, 32 172 L30 194 L54 194 L53 174 C 55 140, 62 116, 70 100 L72 184 L72 206 L168 206 L168 184 L170 100 C 178 116, 185 140, 187 174 L186 194 L210 194 L208 172 C 204 120, 194 70, 178 56 L154 48 Z"/>
  <path class="costura" d="M62 56 C 68 74, 70 88, 70 100"/>
  <path class="costura" d="M178 56 C 172 74, 170 88, 170 100"/>
  <path class="costura" d="M31.6 176 L53.2 176"/>
  <path class="costura" d="M186.8 176 L208.4 176"/>
  <path class="rib" d="M36 178 V192 M41 178 V192 M46 178 V192 M51 178 V192 M190 178 V192 M195 178 V192 M200 178 V192 M205 178 V192"/>
  <path class="costura" d="M72 186 L168 186"/>
  <path class="rib" d="M80 188 V204 M88 188 V204 M96 188 V204 M104 188 V204 M112 188 V204 M120 188 V204 M128 188 V204 M136 188 V204 M144 188 V204 M152 188 V204 M160 188 V204"/>
  <path class="cuerpo" d="M92 142 L148 142 C 150 158, 156 172, 162 182 L78 182 C 84 172, 90 158, 92 142 Z"/>
  <path class="pespunte" d="M95 146 L145 146 C 147 160, 152 170, 156 178 L84 178 C 88 170, 93 160, 95 146"/>
  <path class="cuerpo" d="M86 50 C 78 22, 96 8, 120 8 C 144 8, 162 22, 154 50 C 144 64, 96 64, 86 50 Z"/>
  <path class="hueco" d="M97 50 C 95 31, 105 22, 120 22 C 135 22, 145 31, 143 50 C 134 57, 106 57, 97 50 Z"/>
  <path class="costura" d="M120 8 V22"/>
  <path class="costura" d="M110 57 C 109 70, 108 80, 107 92"/>
  <path class="costura" d="M130 57 C 131 70, 132 80, 133 92"/>
  <rect class="metal" x="104.5" y="91" width="5" height="9" rx="2"/>
  <rect class="metal" x="130.5" y="91" width="5" height="9" rx="2"/>`,
    },
    {
        id: 'campera', nombre: 'Campera',
        svg: `
  <path class="cuerpo" d="M86 48 L62 56 C 46 70, 36 120, 32 172 L30 194 L54 194 L53 174 C 55 140, 62 116, 70 100 L72 184 L72 206 L168 206 L168 184 L170 100 C 178 116, 185 140, 187 174 L186 194 L210 194 L208 172 C 204 120, 194 70, 178 56 L154 48 Z"/>
  <path class="costura" d="M62 56 C 68 74, 70 88, 70 100"/>
  <path class="costura" d="M178 56 C 172 74, 170 88, 170 100"/>
  <path class="costura" d="M31.6 176 L53.2 176"/>
  <path class="costura" d="M186.8 176 L208.4 176"/>
  <path class="rib" d="M36 178 V192 M41 178 V192 M46 178 V192 M51 178 V192 M190 178 V192 M195 178 V192 M200 178 V192 M205 178 V192"/>
  <path class="costura" d="M72 186 L168 186"/>
  <path class="rib" d="M80 188 V204 M88 188 V204 M96 188 V204 M104 188 V204 M112 188 V204 M128 188 V204 M136 188 V204 M144 188 V204 M152 188 V204 M160 188 V204"/>
  <!-- cierre -->
  <path class="cierre" d="M120 54 V205"/>
  <rect class="metal" x="117" y="56" width="6" height="12" rx="1.5"/>
  <!-- bolsillos ojal -->
  <path class="cuerpo" d="M82 140 L86.5 137 L103 163 L98.5 166 Z"/>
  <path class="cuerpo" d="M158 140 L153.5 137 L137 163 L141.5 166 Z"/>
  <!-- cuello -->
  <path class="cuerpo" d="M86 50 L90 32 C 104 27, 136 27, 150 32 L154 50 C 140 44, 128 46, 120 54 C 112 46, 100 44, 86 50 Z"/>
  <path class="hueco" d="M99 35 C 110 32, 130 32, 141 35 C 132 39, 125 42, 120 47 C 115 42, 108 39, 99 35 Z"/>
  <path class="rib" d="M93 36 V47 M99 40 V45 M141 40 V45 M147 36 V47"/>`,
    },
    {
        id: 'chaleco', nombre: 'Chaleco',
        svg: `
  <path class="cuerpo" d="M86 26 L104 26 L120 104 L136 26 L154 26 C 156 58, 162 80, 172 94 L172 196 L126 208 L120 200 L114 208 L68 196 L68 94 C 78 80, 84 58, 86 26 Z"/>
  <path class="hueco" d="M104 26 C 112 32, 128 32, 136 26 L120 104 Z"/>
  <path class="costura" d="M120 104 V200"/>
  <circle class="metal" cx="120" cy="120" r="2.6"/>
  <circle class="metal" cx="120" cy="143" r="2.6"/>
  <circle class="metal" cx="120" cy="166" r="2.6"/>
  <circle class="metal" cx="120" cy="189" r="2.6"/>
  <path class="cuerpo" d="M80 150 L103 146 L103 151 L80 155 Z"/>
  <path class="cuerpo" d="M160 150 L137 146 L137 151 L160 155 Z"/>
  <path class="pespunte" d="M90 29 C 88 60, 82 80, 72 93"/>
  <path class="pespunte" d="M150 29 C 152 60, 158 80, 168 93"/>
  <path class="pespunte" d="M107 29 L120 92 L133 29"/>`,
    },
    {
        id: 'pantalon', nombre: 'Pantalón',
        svg: `
  <path class="cuerpo" d="M73 12 L167 12 L167 27 C 173 60, 175 110, 172 226 L131 226 L120 98 L109 226 L68 226 C 65 110, 67 60, 73 27 Z"/>
  <path class="costura" d="M73 27 L167 27"/>
  <path class="costura" d="M96 27 C 94 44, 85 55, 69.5 60"/>
  <path class="costura" d="M144 27 C 146 44, 155 55, 170.5 60"/>
  <path class="costura" d="M120 27 V94"/>
  <path class="pespunte" d="M128 28 V76 C 128 83, 125 87, 120 89"/>
  <path class="pespunte" d="M75 16 L165 16"/>
  <path class="pespunte" d="M68.2 219 L109.6 219"/>
  <path class="pespunte" d="M130.4 219 L171.8 219"/>
  <rect class="cuerpo" x="85" y="9" width="5" height="20" rx="1.5"/>
  <rect class="cuerpo" x="150" y="9" width="5" height="20" rx="1.5"/>
  <circle class="metal" cx="120" cy="19.5" r="3.4"/>`,
    },
    {
        id: 'bermuda', nombre: 'Bermuda',
        svg: `
  <path class="cuerpo" d="M73 40 L167 40 L167 55 C 172 80, 176 110, 178 150 L128 154 L120 120 L112 154 L62 150 C 64 110, 68 80, 73 55 Z"/>
  <path class="costura" d="M73 55 L167 55"/>
  <path class="costura" d="M96 55 C 94 70, 85 80, 70 84"/>
  <path class="costura" d="M144 55 C 146 70, 155 80, 170 84"/>
  <path class="costura" d="M120 55 V116"/>
  <path class="pespunte" d="M128 56 V100 C 128 106, 125 110, 120 112"/>
  <path class="pespunte" d="M75 44 L165 44"/>
  <path class="pespunte" d="M63 144 L113.4 148"/>
  <path class="pespunte" d="M126.6 148 L177 144"/>
  <rect class="cuerpo" x="85" y="37" width="5" height="20" rx="1.5"/>
  <rect class="cuerpo" x="150" y="37" width="5" height="20" rx="1.5"/>
  <circle class="metal" cx="120" cy="47.5" r="3.4"/>`,
    },
    {
        id: 'short', nombre: 'Short deportivo',
        svg: `
  <path class="cuerpo" d="M74 44 L166 44 L166 62 C 172 84, 178 108, 182 132 L128 138 L120 112 L112 138 L58 132 C 62 108, 68 84, 74 62 Z"/>
  <path class="costura" d="M74 62 L166 62"/>
  <path class="rib" d="M82 46 V60 M90 46 V60 M98 46 V60 M106 46 V60 M134 46 V60 M142 46 V60 M150 46 V60 M158 46 V60"/>
  <path class="costura" d="M117 54 C 115 64, 113 72, 111 82"/>
  <path class="costura" d="M123 54 C 125 64, 127 72, 129 82"/>
  <rect class="metal" x="108" y="81" width="5" height="8" rx="2"/>
  <rect class="metal" x="127" y="81" width="5" height="8" rx="2"/>
  <path class="pespunte" d="M59 126 L113.9 132"/>
  <path class="pespunte" d="M126.1 132 L181 126"/>`,
    },
    {
        id: 'pollera', nombre: 'Pollera',
        svg: `
  <path class="cuerpo" d="M84 40 L156 40 L156 54 L182 176 Q 120 188 58 176 L84 54 Z"/>
  <path class="costura" d="M84 54 L156 54"/>
  <path class="rib" d="M104 56 L94.5 176 M120 56 V178 M136 56 L145.5 176"/>
  <circle class="metal" cx="148" cy="47" r="2.6"/>
  <path class="pespunte" d="M60 170 Q 120 182 180 170"/>`,
    },
    {
        id: 'vestido', nombre: 'Vestido',
        svg: `
  <path class="cuerpo" d="M90 22 L102 22 C 108 50, 132 50, 138 22 L150 22 C 152 52, 160 72, 168 88 C 164 96, 160 100, 158 106 L190 210 Q 120 222 50 210 L82 106 C 80 100, 76 96, 72 88 C 80 72, 88 52, 90 22 Z"/>
  <path class="hueco" d="M102 22 C 110 30, 130 30, 138 22 C 132 50, 108 50, 102 22 Z"/>
  <path class="costura" d="M82 106 Q 120 112 158 106"/>
  <path class="rib" d="M100 112 L85 208 M120 114 V212 M140 112 L155 208"/>
  <path class="pespunte" d="M106 25 C 111 45, 129 45, 134 25"/>
  <path class="pespunte" d="M54 204 Q 120 216 186 204"/>`,
    },
];

module.exports = { PRENDAS };
