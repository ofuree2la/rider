// Demo-only seed data for the Rider front-end prototype.
// Update these records as campus locations and verified drivers change.
export const locations = [
  { id: "hostel-a", name: "Hostel A", zone: "hostels", type: "hostel" },
  { id: "hostel-b", name: "Hostel B", zone: "hostels", type: "hostel" },
  { id: "hostel-c", name: "Hostel C", zone: "hostels", type: "hostel" },
  { id: "main-gate", name: "Main Gate", zone: "campus-edge", type: "gate" },
  { id: "lecture-hall-1", name: "Lecture Hall 1", zone: "campus-core", type: "lecture-hall" },
  { id: "lecture-hall-2", name: "Lecture Hall 2", zone: "campus-core", type: "lecture-hall" },
  { id: "library", name: "University Library", zone: "campus-core", type: "library" },
  { id: "cafeteria", name: "Cafeteria", zone: "campus-core", type: "cafeteria" },
  { id: "law-faculty", name: "Law Faculty", zone: "campus-core", type: "faculty" },
  { id: "arts-faculty", name: "Faculty of Arts", zone: "campus-core", type: "faculty" },
  { id: "chapel", name: "Chapel", zone: "campus-core", type: "chapel" },
  { id: "admin-block", name: "Administration Block", zone: "campus-edge", type: "admin" },
  { id: "bwari-junction", name: "Bwari Junction", zone: "nearby", type: "junction" },
  { id: "bwari-market", name: "Bwari Market", zone: "nearby", type: "market" },
];

export const mockDrivers = [
  {
    id: "driver-001",
    name: "Abdullahi Musa",
    plateNumber: "ABC 123 XY",
    phone: "+234 803 000 1001",
    rating: 4.8,
    verified: true,
  },
  {
    id: "driver-002",
    name: "Chinedu Okafor",
    plateNumber: "ABC 456 XY",
    phone: "+234 803 000 1002",
    rating: 4.6,
    verified: true,
  },
  {
    id: "driver-003",
    name: "Ibrahim Bello",
    plateNumber: "ABC 789 XY",
    phone: "+234 803 000 1003",
    rating: 4.9,
    verified: true,
  },
];

// These accounts and passwords are only for local prototype demos.
// Never store real user passwords in client-side code or localStorage.
export const starterUsers = [
  {
    id: "user-student-demo",
    name: "Demo Student",
    email: "student@rider.demo",
    password: "RiderDemo123!",
    phone: "+234 803 000 2001",
    role: "student",
  },
  {
    id: "user-driver-demo",
    name: "Abdullahi Musa",
    email: "driver@rider.demo",
    password: "RiderDemo123!",
    phone: "+234 803 000 1001",
    role: "driver",
    driverId: "driver-001",
  },
];
