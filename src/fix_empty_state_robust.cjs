const fs = require('fs');

const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/src/components/pages/ProductsIntegration.jsx';
let content = fs.readFileSync(path, 'utf8');

// We need to move the displayArticles.length === 0 check.
// Originally:
// ) : displayArticles.length === 0 ? (
//    <div className="flex flex-col items-center justify-center h-full text-slate-400">
//       <i className="fa-solid fa-box-open text-6xl mb-4 text-slate-200"></i>
//       <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
//    </div>
// ) : (
//    <div>

// Change the first part:
content = content.replace(/\) : displayArticles\.length === 0 \? \([\s\S]*?<p className="font-bold text-lg text-slate-500">No se encontraron artículos<\/p>\s*<\/div>\s*\) : \(\s*<div>/, ') : (\n                        <div>');

// We need to put the empty state before the grid:
// <div className="grid grid-cols-1
// Change the second part:
content = content.replace(/<div className="grid grid-cols-1/g, `{displayArticles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                    <i className="fa-solid fa-box-open text-6xl mb-4 text-slate-200"></i>
                                    <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1`);

// Then we need to add the closing `)}` after the grid ends:
//                                 ))}
//                             </div>
//                         </div>
//                     )}
//                 </div>
content = content.replace(/                                \)\)}\s*<\/div>\s*<\/div>\s*\)}/g, `                                ))}
                            </div>
                            )}
                        </div>
                    )}`);

// Fix dynamic toast imports
content = content.replace(/import\('sonner'\)\.then\(m => m\.toast\.success\((.*?)\)\)/g, 'toast.success($1)');
content = content.replace(/import\('sonner'\)\.then\(m => m\.toast\.error\((.*?)\)\)/g, 'toast.error($1)');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed UI empty state robustly');
