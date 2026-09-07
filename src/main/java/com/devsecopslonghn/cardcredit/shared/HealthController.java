package com.devsecopslonghn.cardcredit.shared;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final MongoTemplate mongo;
  public HealthController(MongoTemplate mongo) { this.mongo = mongo; }
  @GetMapping("/health") public Health health() { return new Health("ok"); }
  @GetMapping("/ready") public ResponseEntity<Health> ready() {
    try { mongo.executeCommand(new org.bson.Document("ping", 1)); return ResponseEntity.ok(new Health("ready")); }
    catch (RuntimeException e) { return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new Health("not_ready")); }
  }
  public record Health(String status) {}
}
