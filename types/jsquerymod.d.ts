declare namespace JSQuery {
    export declare class Extension {
        constructor();
        get(): {
            $: {};
            Element: {};
            static_Element: {};
            static_ElementArray: {};
            ElementArray: {};
            JSQuery: {};
        };
        $(): {};
        Element(): {};
        ElementArray(): {};
        static_Element(): {};
        static_ElementArray(): {};
        JSQuery(): {};
    }
    export declare class Element {
        #private;
        elt: HTMLElement;
        static from(elt: HTMLElement): Element | null;
        static from(elt: NodeList | HTMLCollection): ElementArray;
        new(): Element;
        constructor(elt: HTMLElement);
        on(e: any, func: (this: HTMLElement, ev: any) => any, s?: boolean | AddEventListenerOptions): this;
        removeEvent(e: any, func: (this: HTMLElement, ev: any) => any, s?: boolean | AddEventListenerOptions): this;
        trigger(e: any): this;
        css(styles: Record<string, any>): this;
        getCss(style: string): any;
        props(props: Record<string, any>): this;
        getProp(name: string): string;
        id(): string;
        id(val: string): this;
        class(names: string | string[]): this;
        removeClass(names: string | string[]): this;
        toggleClass(names: string | string[]): this;
        hasClass(name: string): boolean;
        $(q: any): Element | null;
        all(q: any): ElementArray;
        is(q: string): boolean;
        child(children: Element | Element[]): this;
        remove(): this;
        get children(): ElementArray;
        html(): string;
        html(val: string): this;
        text(): string;
        text(val: string): this;
        rect(): any;
        value(): string;
        value(val: string): this;
        checked(): boolean;
        checked(val: boolean): this;
        click(func?: (this: HTMLElement, ev: any) => any, s?: boolean | AddEventListenerOptions): this;
    }
    export declare class Caching extends Extension {
        $(): {
            cache<T extends (...args: any[]) => any>(func: T): T;
        };
    }
    export declare class ElementArray extends Array<Element> {
        on<K extends keyof DocumentEventMap>(e: K, func: (this: HTMLElement, ev: DocumentEventMap[K]) => any, s?: boolean | AddEventListenerOptions): this;
        rect(): any[];
        hasClass(c: string): boolean[];
        is(q: string): boolean[];
        checked(): boolean[];
        checked(val: boolean): this;
        trigger(e: any): this;
        css(styles: Record<string, any>): this;
        props(props: Record<string, any>): this;
        class(names: string | string[]): this;
        removeClass(names: string | string[]): this;
        toggleClass(names: string | string[]): this;
        remove(): this;
        new(): ElementArray;
        click(func: (this: HTMLElement, ev: any) => any, s?: boolean | AddEventListenerOptions): this;
    }
    export declare const Plugin: typeof Extension;
    export type Plugin = Extension;
}
