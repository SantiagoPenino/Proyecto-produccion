const fs = require('fs');

const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/src/components/pages/ProductsIntegration.jsx';
let content = fs.readFileSync(path, 'utf8');

const targetStr = `                    ) : displayArticles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <i className="fa-solid fa-box-open text-6xl mb-4 text-slate-200"></i>
                            <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
                        </div>
                    ) : (
                        <div>
                            <div className="mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">`;

const replaceStr = `                    ) : (
                        <div>
                            <div className="mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">`;

content = content.replace(targetStr, replaceStr);

const targetGridStr = `                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                                {displayArticles.map(art => (
                                    <ArticleCard
                                        key={art.ProIdProducto ?? art.CodArticulo}
                                        art={art}
                                        onEdit={setEditing}
                                        showImages={showImages}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>`;

const replaceGridStr = `                            )}

                            {displayArticles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                    <i className="fa-solid fa-box-open text-6xl mb-4 text-slate-200"></i>
                                    <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                                    {displayArticles.map(art => (
                                        <ArticleCard
                                            key={art.ProIdProducto ?? art.CodArticulo}
                                            art={art}
                                            onEdit={setEditing}
                                            showImages={showImages}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>`;

content = content.replace(targetGridStr, replaceGridStr);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed UI empty state');
