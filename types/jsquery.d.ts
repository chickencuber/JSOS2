declare function $(q: any): JSQuery.Element | null;
declare namespace $ {
    var from: typeof JSQuery.Element.from;
    var all: (q: any) => JSQuery.ElementArray;
    var head: () => JSQuery.Element;
    var body: () => JSQuery.Element;
    var doc: () => JSQuery.Element;
    var create: (t: any) => JSQuery.Element;
    var loadExtension: (extend: new () => JSQuery.Extension) => void;
    var loadPlugin: (extend: new () => JSQuery.Extension) => void;
}
