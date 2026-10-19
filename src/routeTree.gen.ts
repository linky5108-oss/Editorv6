/* eslint-disable */
// @ts-nocheck

import { Route as rootRouteImport } from "./routes/__root";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as EditorRouteImport } from "./routes/editor";

const IndexRoute = IndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRouteImport,
} as any);

const EditorRoute = EditorRouteImport.update({
  id: "/editor",
  path: "/editor",
  getParentRoute: () => rootRouteImport,
} as any);

export interface FileRoutesByFullPath {
  "/": typeof IndexRoute;
  "/editor": typeof EditorRoute;
}

export interface FileRoutesByTo {
  "/": typeof IndexRoute;
  "/editor": typeof EditorRoute;
}

export interface FileRoutesById {
  __root__: typeof rootRouteImport;
  "/": typeof IndexRoute;
  "/editor": typeof EditorRoute;
}

export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath;
  fullPaths: "/" | "/editor";
  fileRoutesByTo: FileRoutesByTo;
  to: "/" | "/editor";
  id: "__root__" | "/" | "/editor";
  fileRoutesById: FileRoutesById;
}

export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute;
  EditorRoute: typeof EditorRoute;
}

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/": {
      id: "/";
      path: "/";
      fullPath: "/";
      preLoaderRoute: typeof IndexRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/editor": {
      id: "/editor";
      path: "/editor";
      fullPath: "/editor";
      preLoaderRoute: typeof EditorRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/about": {
      id: "/about";
      path: "/about";
      fullPath: "/about";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/admin": {
      id: "/admin";
      path: "/admin";
      fullPath: "/admin";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/auth": {
      id: "/auth";
      path: "/auth";
      fullPath: "/auth";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/feed": {
      id: "/feed";
      path: "/feed";
      fullPath: "/feed";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/history": {
      id: "/history";
      path: "/history";
      fullPath: "/history";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/orbes": {
      id: "/orbes";
      path: "/orbes";
      fullPath: "/orbes";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/paint": {
      id: "/paint";
      path: "/paint";
      fullPath: "/paint";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/plus": {
      id: "/plus";
      path: "/plus";
      fullPath: "/plus";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/profile": {
      id: "/profile";
      path: "/profile";
      fullPath: "/profile";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/profile/$userId": {
      id: "/profile/$userId";
      path: "/profile/$userId";
      fullPath: "/profile/$userId";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/reset-password": {
      id: "/reset-password";
      path: "/reset-password";
      fullPath: "/reset-password";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
    "/search": {
      id: "/search";
      path: "/search";
      fullPath: "/search";
      preLoaderRoute: any;
      parentRoute: typeof rootRouteImport;
    };
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute,
  EditorRoute,
};

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>();
