import * as express from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any; // you can type this better later
    }
  }
}